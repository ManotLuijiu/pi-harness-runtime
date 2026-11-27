/**
 * The derived index, built safely.
 *
 * The graph owns the published skills. The index is a rebuildable search
 * view of it, and this module is the job that builds that view. It is pure:
 * the readers of the graph, the embedder and the vector store are injected,
 * so the policy can be proved without a cluster.
 *
 * The rules of the job are the rules of the plan:
 *
 * - the job is invoked explicitly and writes with a separate writer
 *   credential; the runtime readers stay read-only,
 * - the index holds the name, the description and the curated task tags of
 *   a skill. The instructions stay in the graph,
 * - the job reads a consistent snapshot of the catalog. A catalog that
 *   changes during the scan does not produce a complete generation,
 * - only the changed records are embedded again; the unchanged embeddings
 *   are preserved,
 * - the batches are bounded and declared, and a failed batch is retried
 *   instead of restarting the whole job,
 * - the generation is staged, validated and only then activated. A partial
 *   scan, a refused permission or a failed batch never switches the active
 *   generation and never removes it,
 * - the revoked and the deleted entries of a completed snapshot are marked
 *   at once, before the cleanup of the vectors.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { IndexManifest } from "./skill-retrieval.ts";
import { skillIdentity, skillRefOf, validateIndexManifest } from "./skill-retrieval.ts";

/** The name of the file that holds the pointer to the active generation. */
const INDEX_MANIFEST_FILE = "index-manifest.json";

/** One entry of the catalog of the graph. */
export interface SyncEntry {
	/** The id the graph knows the skill by. */
	id: string;
	/** The name of the skill. */
	name: string;
	/** The description of the skill (discovery metadata). */
	description?: string;
	/** The curated task tags of the skill (discovery metadata). */
	tags?: string[];
	/** The revision of the publication the skill belongs to. */
	revision: string;
	/** The hash of the instructions of the skill. */
	sha256: string;
	/** The skill was revoked in the snapshot. */
	revoked?: boolean;
}

/** A consistent read of the catalog of the graph. */
export interface SourceSnapshot {
	/** The digest of the catalog the snapshot was read from. */
	digest: string;
	/** The entries of the catalog. */
	entries: SyncEntry[];
	/** When the snapshot was taken. */
	takenAt: string;
}

/** The identity of a record of the index. */
export interface IndexedRecord {
	/** The canonical identity of the skill. */
	identity: string;
	/** The revision the record was built from. */
	revision: string;
	/** The hash of the instructions of the skill. */
	sha256: string;
}

/** The active generation of the index. */
export interface ActiveIndex {
	/** The manifest of the active generation. */
	manifest: IndexManifest;
	/** The records the active generation holds. */
	records: IndexedRecord[];
}

/** The change of one skill between the snapshot and the index. */
export type ChangeKind = "added" | "changed" | "revoked" | "unchanged" | "removed";

/** The difference between the snapshot and the active index. */
export interface SyncDelta {
	/** The skills the index does not hold. */
	added: SyncEntry[];
	/** The skills whose revision or hash changed. */
	changed: SyncEntry[];
	/** The skills the snapshot revoked. */
	revoked: SyncEntry[];
	/** The skills the snapshot no longer knows, by identity. */
	removed: string[];
	/** The skills whose embedding is preserved. */
	unchanged: SyncEntry[];
}

/** One bounded batch of the job. */
export interface Batch {
	/** The place of the batch in the job. */
	index: number;
	/** The entries of the batch. */
	entries: SyncEntry[];
}

/** The plan of a run of the job. */
export interface SyncPlan {
	/** The difference between the snapshot and the active index. */
	delta: SyncDelta;
	/** The bounded batches of the job. */
	batches: Batch[];
	/** The declared size of a batch. */
	batchSize: number;
	/** The declared concurrency of the job. */
	concurrency: number;
	/** The digest of the snapshot the plan was built from. */
	snapshotDigest: string;
	/** The number of the records the generation has to hold. */
	expectedCount: number;
}

/** The state of one batch of a run. */
export interface BatchState {
	/** The place of the batch in the job. */
	index: number;
	/** The state of the batch. */
	state: "pending" | "done" | "failed";
	/** How often the batch was tried. */
	attempts: number;
	/** The reason of the last failure. */
	reason?: string;
}

/** The checkpoint of a run. */
export interface RunCheckpoint {
	/** The id of the run. */
	runId: string;
	/** The digest of the snapshot the run reads. */
	snapshotDigest: string;
	/** The state of every batch. */
	batches: BatchState[];
	/** The identity of the records that are already indexed. */
	indexed: string[];
}

/** The failure of a contract of the job. */
export class SkillSyncError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SkillSyncError";
	}
}

/**
 * The path of the pointer to the active generation.
 *
 * The pointer lives in the cache of the source: the readers of the graph
 * find it there, and the sync job writes it when it activates a
 * generation.
 */
export function indexManifestPath(cacheDir: string): string {
	return join(cacheDir, INDEX_MANIFEST_FILE);
}

/**
 * The pointer to the active generation.
 */
export function writeIndexManifest(
	cacheDir: string,
	manifest: IndexManifest,
): void {
	mkdirSync(cacheDir, { recursive: true });
	writeFileSync(
		indexManifestPath(cacheDir),
		`${JSON.stringify(manifest, null, 2)}\n`,
		"utf8",
	);
}

/**
 * The pointer to the active generation.
 *
 * A machine without a pointer has no index. That is not an error, and a
 * broken pointer is not a manifest either: the readers treat it as the
 * absence of the index.
 */
export function readIndexManifest(cacheDir: string): IndexManifest | undefined {
	const file = indexManifestPath(cacheDir);
	if (!existsSync(file)) return undefined;
	try {
		return validateIndexManifest(JSON.parse(readFileSync(file, "utf8")));
	} catch {
		return undefined;
	}
}

/**
 * The freshness of the active generation.
 */
export interface IndexFreshness {
	/** The age of the generation in milliseconds. */
	ageMs: number;
	/** The index does not hold every skill of the source. */
	behind: boolean;
	/** The reason of the lag. */
	reason?: string;
}

/**
 * The freshness of the active generation.
 *
 * The facts the runtime knows are the count of the records of the
 * generation and the age of its activation. The status never claims that
 * the index is synchronized: a health check is not a proof.
 */
export function indexFreshness(options: {
	/** The manifest of the active generation. */
	manifest: IndexManifest;
	/** The number of the skills the source holds. */
	sourceCount: number;
	/** The current time. */
	now: string;
}): IndexFreshness {
	const activated =
		options.manifest.activatedAt ?? options.manifest.createdAt;
	const activatedAt = Date.parse(activated);
	const now = Date.parse(options.now);
	const ageMs =
		Number.isNaN(activatedAt) || Number.isNaN(now)
			? 0
			: Math.max(0, now - activatedAt);
	if (options.manifest.indexedCount !== options.sourceCount) {
		return {
			ageMs,
			behind: true,
			reason: `the index holds ${options.manifest.indexedCount} records and the source holds ${options.sourceCount}`,
		};
	}
	return { ageMs, behind: false };
}

/**
 * The identity of a skill of the snapshot.
 */
function identityOf(
	entry: SyncEntry,
	scope: { namespace: string; graph: string },
): string {
	return skillIdentity(
		skillRefOf(
			{
				id: entry.id,
				name: entry.name,
				description: entry.description ?? "",
				revision: entry.revision,
				sha256: entry.sha256,
			},
			scope,
		),
	);
}

/**
 * The difference between the snapshot and the active index.
 *
 * A skill that changed its revision or its hash is embedded again. A skill
 * the snapshot revoked is marked, not embedded. A skill the snapshot no
 * longer knows is removed from the generation, and it is excluded at the
 * authorization of the retrieval at once.
 */
export function planSync(options: {
	/** The snapshot of the catalog. */
	snapshot: SourceSnapshot;
	/** The active generation of the index. */
	active?: ActiveIndex;
	/** The scope of the source. */
	scope: { namespace: string; graph: string };
	/** The declared size of a batch. */
	batchSize: number;
	/** The declared concurrency of the job. */
	concurrency: number;
}): SyncPlan {
	const batchSize = Math.max(1, Math.floor(options.batchSize));
	const concurrency = Math.max(1, Math.floor(options.concurrency));
	const scope = options.scope;
	const active = options.active;
	const records = new Map<string, IndexedRecord>();
	for (const record of active?.records ?? []) {
		records.set(record.identity, record);
	}

	const delta: SyncDelta = {
		added: [],
		changed: [],
		revoked: [],
		removed: [],
		unchanged: [],
	};
	const seen = new Set<string>();

	for (const entry of options.snapshot.entries) {
		const identity = identityOf(entry, scope);
		seen.add(identity);
		const known = records.get(identity);
		if (entry.revoked) {
			delta.revoked.push(entry);
			continue;
		}
		if (!known) {
			delta.added.push(entry);
			continue;
		}
		if (known.revision !== entry.revision || known.sha256 !== entry.sha256) {
			delta.changed.push(entry);
			continue;
		}
		delta.unchanged.push(entry);
	}

	for (const [identity] of records) {
		if (!seen.has(identity)) {
			delta.removed.push(identity);
		}
	}

	const toEmbed = [...delta.added, ...delta.changed];
	const batches = planBatches(toEmbed, batchSize);
	const expectedCount =
		options.snapshot.entries.filter((entry) => !entry.revoked).length;

	return {
		delta,
		batches,
		batchSize,
		concurrency,
		snapshotDigest: options.snapshot.digest,
		expectedCount,
	};
}

/**
 * The bounded batches of the entries.
 *
 * The batches are explicit: the job never embeds more than one batch at a
 * time without the declared concurrency, and the checkpoint of every batch
 * is written.
 */
export function planBatches(entries: SyncEntry[], batchSize: number): Batch[] {
	const size = Math.max(1, Math.floor(batchSize));
	const batches: Batch[] = [];
	for (let index = 0; index < entries.length; index += size) {
		batches.push({
			index: batches.length,
			entries: entries.slice(index, index + size),
		});
	}
	return batches;
}

/**
 * The checkpoint of a new run.
 */
export function newCheckpoint(plan: SyncPlan, runId: string): RunCheckpoint {
	return {
		runId,
		snapshotDigest: plan.snapshotDigest,
		batches: plan.batches.map((batch) => ({
			index: batch.index,
			state: "pending",
			attempts: 0,
		})),
		indexed: [],
	};
}

/**
 * The batches that still have to run.
 *
 * A failed batch is retried, the other batches are not restarted.
 */
export function pendingBatches(
	checkpoint: RunCheckpoint,
): Array<{ index: number; attempts: number }> {
	return checkpoint.batches
		.filter((batch) => batch.state !== "done")
		.map((batch) => ({ index: batch.index, attempts: batch.attempts }));
}

/**
 * The record of a finished batch.
 */
export function completeBatch(
	checkpoint: RunCheckpoint,
	index: number,
	identities: string[],
): RunCheckpoint {
	const batches = checkpoint.batches.map((batch) =>
		batch.index === index
			? { ...batch, state: "done" as const, attempts: batch.attempts + 1 }
			: batch,
	);
	const indexed = new Set(checkpoint.indexed);
	for (const identity of identities) indexed.add(identity);
	return { ...checkpoint, batches, indexed: [...indexed] };
}

/**
 * The record of a failed batch.
 *
 * The batch stays open: the job retries it, it does not start over.
 */
export function failBatch(
	checkpoint: RunCheckpoint,
	index: number,
	reason: string,
): RunCheckpoint {
	const batches = checkpoint.batches.map((batch) =>
		batch.index === index
			? {
				...batch,
				state: "failed" as const,
				attempts: batch.attempts + 1,
				reason,
			}
			: batch,
	);
	return { ...checkpoint, batches };
}

/**
 * The manifest of the staging generation.
 *
 * The generation starts as "building": it is not the generation the readers
 * use.
 */
export function stagingManifest(options: {
	/** The plan of the run. */
	plan: SyncPlan;
	/** The scope of the source. */
	scope: { namespace: string; graph: string };
	/** The model that produced the embeddings. */
	embeddingModel: string;
	/** The number of dimensions of the embeddings. */
	embeddingDimensions: number;
	/** The id of the run. */
	runId: string;
	/** When the generation was started. */
	createdAt: string;
}): IndexManifest {
	return {
		schemaVersion: 1,
		namespace: options.scope.namespace,
		graph: options.scope.graph,
		sourceSnapshot: options.plan.snapshotDigest,
		embeddingModel: options.embeddingModel,
		embeddingDimensions: options.embeddingDimensions,
		indexedCount: 0,
		runId: options.runId,
		state: "building",
		createdAt: options.createdAt,
	};
}

/**
 * The validation of a staged generation.
 *
 * The generation is only a candidate for the activation when it holds
 * every skill of the snapshot, when every record carries the canonical
 * identity, when the payload has the schema of the index and when the
 * dimensions of the embeddings are the ones the manifest declares.
 */
export function validateGeneration(options: {
	/** The manifest of the staged generation. */
	manifest: IndexManifest;
	/** The plan of the run. */
	plan: SyncPlan;
	/** The records the generation holds. */
	records: IndexedRecord[];
	/** The payload of every record carries the schema of the index. */
	payloadSchemaOk: boolean;
	/** The dimensions of the embeddings are the declared ones. */
	dimensionsOk: boolean;
	/** The scope of the source. */
	scope: { namespace: string; graph: string };
}): { ok: boolean; reasons: string[] } {
	const reasons: string[] = [];
	const expected = new Set<string>();
	for (const entry of options.plan.snapshotDigest
		? options.plan.delta.added.concat(options.plan.delta.changed, options.plan.delta.unchanged)
		: []) {
		if (entry.revoked) continue;
		expected.add(identityOf(entry, options.scope));
	}
	const indexed = new Set(options.records.map((record) => record.identity));
	for (const identity of expected) {
		if (!indexed.has(identity)) {
			reasons.push(`the generation does not hold ${identity}`);
		}
	}
	if (options.records.length !== options.plan.expectedCount) {
		reasons.push(
			`the generation holds ${options.records.length} records and the snapshot holds ${options.plan.expectedCount}`,
		);
	}
	if (!options.payloadSchemaOk) {
		reasons.push("the payload of the index does not have the schema of the index");
	}
	if (!options.dimensionsOk) {
		reasons.push(
			`the embeddings do not have the ${options.manifest.embeddingDimensions} dimensions the manifest declares`,
		);
	}
	return { ok: reasons.length === 0, reasons };
}

/**
 * The activation of a staged generation.
 *
 * The activation happens only when every batch of the run is done, when the
 * catalog did not change during the scan and when the validation of the
 * generation passed. Otherwise the active generation stays as it is: it is
 * never switched to a partial generation and never removed.
 */
export function activateGeneration(options: {
	/** The manifest of the staged generation. */
	manifest: IndexManifest;
	/** The validation of the generation. */
	validation: { ok: boolean; reasons: string[] };
	/** The checkpoint of the run. */
	checkpoint: RunCheckpoint;
	/** The digest of the catalog when the scan ended. */
	finalDigest: string;
	/** The digest of the catalog the run reads. */
	plannedDigest: string;
	/** When the generation was activated. */
	activatedAt: string;
}): { activated: boolean; manifest: IndexManifest; reason?: string } {
	const failed = options.checkpoint.batches.filter((batch) => batch.state === "failed");
	if (failed.length > 0) {
		return {
			activated: false,
			manifest: options.manifest,
			reason: `the batch ${failed[0].index} failed: ${failed[0].reason ?? "unknown reason"}`,
		};
	}
	const open = options.checkpoint.batches.filter((batch) => batch.state !== "done");
	if (open.length > 0) {
		return {
			activated: false,
			manifest: options.manifest,
			reason: `the batch ${open[0].index} is not finished`,
		};
	}
	if (options.finalDigest !== options.plannedDigest) {
		return {
			activated: false,
			manifest: options.manifest,
			reason: "the catalog of the graph changed during the scan",
		};
	}
	if (!options.validation.ok) {
		return {
			activated: false,
			manifest: options.manifest,
			reason: options.validation.reasons[0] ?? "the generation was not validated",
		};
	}
	return {
		activated: true,
		manifest: { ...options.manifest, state: "active", activatedAt: options.activatedAt },
	};
}

/**
 * The generations that may be cleaned.
 *
 * A generation is cleaned only when another generation is active and the
 * retention window has passed. The active generation is never a candidate.
 */
export function obsoleteGenerations(options: {
	/** Every generation the index knows. */
	generations: IndexManifest[];
	/** The run of the active generation. */
	activeRunId: string;
	/** The retention window in milliseconds. */
	retentionMs: number;
	/** The current time. */
	now: string;
}): IndexManifest[] {
	const now = Date.parse(options.now);
	return options.generations.filter((generation) => {
		if (generation.runId === options.activeRunId) return false;
		if (generation.state !== "active" && generation.state !== "retired") return false;
		const activated = generation.activatedAt
			? Date.parse(generation.activatedAt)
			: Date.parse(generation.createdAt);
		if (Number.isNaN(activated) || Number.isNaN(now)) return false;
		return now - activated >= options.retentionMs;
	});
}

/**
 * The stable read of a catalog.
 *
 * The job reads the catalog twice and compares the digests: a catalog that
 * changed between the two reads is not a consistent snapshot, and the scan
 * of such a catalog is never marked complete.
 */
export function stableSnapshot(digests: string[]): {
	stable: boolean;
	digest?: string;
} {
	if (digests.length < 2) {
		return { stable: false };
	}
	const first = digests[0];
	for (const digest of digests) {
		if (digest !== first) return { stable: false };
	}
	return { stable: true, digest: first };
}

/**
 * The payload of a record of the index.
 *
 * The payload holds the discovery metadata and the canonical identity. The
 * instructions of a skill never enter the index.
 */
export function indexPayload(options: {
	entry: SyncEntry;
	scope: { namespace: string; graph: string };
}): Record<string, string> {
	const identity = identityOf(options.entry, options.scope);
	return {
		identity,
		namespace: options.scope.namespace,
		graph: options.scope.graph,
		id: options.entry.id,
		name: options.entry.name,
		description: options.entry.description ?? "",
		tags: (options.entry.tags ?? []).join(","),
		revision: options.entry.revision,
		sha256: options.entry.sha256,
	};
}
