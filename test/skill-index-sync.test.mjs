/**
 * The derived index, built safely.
 *
 * The tests prove the rules of the job: the delta of the snapshot, the
 * bounded batches, the retry of a failed batch, the refusal to activate a
 * partial generation and the refusal to clean a generation too early.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	activateGeneration,
	completeBatch,
	failBatch,
	indexPayload,
	newCheckpoint,
	obsoleteGenerations,
	pendingBatches,
	planBatches,
	planSync,
	stagingManifest,
	stableSnapshot,
	validateGeneration,
} from "../harness/skill-index-sync.ts";
import { skillIdentity, skillRefOf } from "../harness/skill-retrieval.ts";

const scope = { namespace: "org-a", graph: "skills" };

/** An entry of a catalog. */
function entry(overrides = {}) {
	return {
		id: "sk-deploy",
		name: "deploy",
		description: "ship a release",
		revision: "pub-1",
		sha256: "a".repeat(64),
		...overrides,
	};
}

/** A snapshot of a catalog. */
function snapshot(entries, digest = "digest-1") {
	return { digest, entries, takenAt: "2026-11-27T00:00:00.000Z" };
}

/** The active index of a test. */
function activeOf(entries) {
	return {
		manifest: {
			schemaVersion: 1,
			namespace: scope.namespace,
			graph: scope.graph,
			sourceSnapshot: "digest-0",
			embeddingModel: "text-embedding-3-small",
			embeddingDimensions: 1536,
			indexedCount: entries.length,
			runId: "run-0",
			state: "active",
			createdAt: "2026-11-26T00:00:00.000Z",
			activatedAt: "2026-11-26T00:00:00.000Z",
		},
		records: entries.map((item) => ({
			identity: identityOf(item),
			revision: item.revision,
			sha256: item.sha256,
		})),
	};
}

/** The identity of an entry, as the job computes it. */
function identityOf(item) {
	return skillIdentity(
		skillRefOf(
			{
				id: item.id,
				name: item.name,
				description: item.description ?? "",
				revision: item.revision,
				sha256: item.sha256,
			},
			scope,
		),
	);
}

test("a new skill is embedded and an unchanged skill keeps its embedding", () => {
	const kept = entry({ id: "sk-kept", name: "kept" });
	const fresh = entry({ id: "sk-fresh", name: "fresh" });
	const plan = planSync({
		snapshot: snapshot([kept, fresh]),
		active: activeOf([kept]),
		scope,
		batchSize: 10,
		concurrency: 2,
	});
	assert.deepEqual(plan.delta.added.map((item) => item.id), ["sk-fresh"]);
	assert.deepEqual(plan.delta.unchanged.map((item) => item.id), ["sk-kept"]);
	assert.equal(plan.batches.length, 1);
	assert.equal(plan.expectedCount, 2);
});

test("a changed revision is embedded again", () => {
	const before = entry();
	const after = entry({ revision: "pub-2" });
	const plan = planSync({
		snapshot: snapshot([after]),
		active: activeOf([before]),
		scope,
		batchSize: 10,
		concurrency: 1,
	});
	assert.deepEqual(plan.delta.changed.map((item) => item.id), ["sk-deploy"]);
	assert.equal(plan.delta.added.length, 0);
});

test("a revoked skill is marked and not embedded", () => {
	const revoked = entry({ revoked: true });
	const plan = planSync({
		snapshot: snapshot([revoked]),
		active: activeOf([entry()]),
		scope,
		batchSize: 10,
		concurrency: 1,
	});
	assert.deepEqual(plan.delta.revoked.map((item) => item.id), ["sk-deploy"]);
	assert.equal(plan.batches.length, 0, "a revoked skill is not embedded");
	assert.equal(plan.expectedCount, 0, "a revoked skill is not part of the snapshot");
});

test("a skill the snapshot no longer knows is removed", () => {
	const plan = planSync({
		snapshot: snapshot([]),
		active: activeOf([entry()]),
		scope,
		batchSize: 10,
		concurrency: 1,
	});
	assert.equal(plan.delta.removed.length, 1);
});

test("the batches are bounded and declared", () => {
	const entries = Array.from({ length: 7 }, (_, index) =>
		entry({ id: `sk-${index}`, name: `skill-${index}` }),
	);
	const batches = planBatches(entries, 3);
	assert.equal(batches.length, 3);
	assert.equal(batches[0].entries.length, 3);
	assert.equal(batches[2].entries.length, 1);
	assert.deepEqual(
		batches.map((batch) => batch.index),
		[0, 1, 2],
	);
	const plan = planSync({
		snapshot: snapshot(entries),
		scope,
		batchSize: 3,
		concurrency: 4,
	});
	assert.equal(plan.batchSize, 3);
	assert.equal(plan.concurrency, 4);
	assert.equal(plan.batches.length, 3);
});

test("a failed batch is retried and the other batches are not restarted", () => {
	const entries = Array.from({ length: 4 }, (_, index) =>
		entry({ id: `sk-${index}`, name: `skill-${index}` }),
	);
	const plan = planSync({
		snapshot: snapshot(entries),
		scope,
		batchSize: 2,
		concurrency: 2,
	});
	let checkpoint = newCheckpoint(plan, "run-1");
	assert.equal(pendingBatches(checkpoint).length, 2);
	checkpoint = completeBatch(checkpoint, 0, [identityOf(entries[0])]);
	checkpoint = failBatch(checkpoint, 1, "the cluster refused the write");
	const pending = pendingBatches(checkpoint);
	assert.equal(pending.length, 1, "the finished batch is not run again");
	assert.equal(pending[0].index, 1);
	assert.equal(checkpoint.batches[1].attempts, 1);
});

test("the activation refuses when a batch failed", () => {
	const plan = planSync({
		snapshot: snapshot([entry()]),
		scope,
		batchSize: 5,
		concurrency: 1,
	});
	let checkpoint = newCheckpoint(plan, "run-1");
	checkpoint = failBatch(checkpoint, 0, "the cluster refused the write");
	const manifest = stagingManifest({
		plan,
		scope,
		embeddingModel: "text-embedding-3-small",
		embeddingDimensions: 1536,
		runId: "run-1",
		createdAt: "2026-11-27T00:00:00.000Z",
	});
	const outcome = activateGeneration({
		manifest,
		validation: { ok: true, reasons: [] },
		checkpoint,
		finalDigest: "digest-1",
		plannedDigest: "digest-1",
		activatedAt: "2026-11-27T01:00:00.000Z",
	});
	assert.equal(outcome.activated, false);
	assert.match(outcome.reason, /batch 0 failed/);
	assert.equal(outcome.manifest.state, "building", "the generation stays a staging one");
});

test("the activation refuses when the catalog changed during the scan", () => {
	const plan = planSync({
		snapshot: snapshot([entry()]),
		scope,
		batchSize: 5,
		concurrency: 1,
	});
	let checkpoint = newCheckpoint(plan, "run-1");
	checkpoint = completeBatch(checkpoint, 0, [identityOf(entry())]);
	const manifest = stagingManifest({
		plan,
		scope,
		embeddingModel: "text-embedding-3-small",
		embeddingDimensions: 1536,
		runId: "run-1",
		createdAt: "2026-11-27T00:00:00.000Z",
	});
	const outcome = activateGeneration({
		manifest,
		validation: { ok: true, reasons: [] },
		checkpoint,
		finalDigest: "digest-2",
		plannedDigest: "digest-1",
		activatedAt: "2026-11-27T01:00:00.000Z",
	});
	assert.equal(outcome.activated, false);
	assert.match(outcome.reason, /changed during the scan/);
});

test("the activation refuses when the generation was not validated", () => {
	const plan = planSync({
		snapshot: snapshot([entry()]),
		scope,
		batchSize: 5,
		concurrency: 1,
	});
	let checkpoint = newCheckpoint(plan, "run-1");
	checkpoint = completeBatch(checkpoint, 0, [identityOf(entry())]);
	const manifest = stagingManifest({
		plan,
		scope,
		embeddingModel: "text-embedding-3-small",
		embeddingDimensions: 1536,
		runId: "run-1",
		createdAt: "2026-11-27T00:00:00.000Z",
	});
	const outcome = activateGeneration({
		manifest,
		validation: { ok: false, reasons: ["the generation does not hold sk-deploy"] },
		checkpoint,
		finalDigest: "digest-1",
		plannedDigest: "digest-1",
		activatedAt: "2026-11-27T01:00:00.000Z",
	});
	assert.equal(outcome.activated, false);
	assert.match(outcome.reason, /does not hold/);
});

test("the validation names the missing record, the wrong count and the dimensions", () => {
	const plan = planSync({
		snapshot: snapshot([entry()]),
		scope,
		batchSize: 5,
		concurrency: 1,
	});
	const manifest = stagingManifest({
		plan,
		scope,
		embeddingModel: "text-embedding-3-small",
		embeddingDimensions: 1536,
		runId: "run-1",
		createdAt: "2026-11-27T00:00:00.000Z",
	});
	const outcome = validateGeneration({
		manifest,
		plan,
		records: [],
		payloadSchemaOk: false,
		dimensionsOk: false,
		scope,
	});
	assert.equal(outcome.ok, false);
	assert.equal(outcome.reasons.length, 4);
	assert.ok(outcome.reasons.some((reason) => reason.includes("does not hold")));
	assert.ok(outcome.reasons.some((reason) => reason.includes("schema")));
	assert.ok(outcome.reasons.some((reason) => reason.includes("dimensions")));
});

test("the activation happens when every batch is done and the validation passed", () => {
	const plan = planSync({
		snapshot: snapshot([entry()]),
		scope,
		batchSize: 5,
		concurrency: 1,
	});
	let checkpoint = newCheckpoint(plan, "run-1");
	checkpoint = completeBatch(checkpoint, 0, [identityOf(entry())]);
	const manifest = stagingManifest({
		plan,
		scope,
		embeddingModel: "text-embedding-3-small",
		embeddingDimensions: 1536,
		runId: "run-1",
		createdAt: "2026-11-27T00:00:00.000Z",
	});
	const outcome = activateGeneration({
		manifest,
		validation: { ok: true, reasons: [] },
		checkpoint,
		finalDigest: "digest-1",
		plannedDigest: "digest-1",
		activatedAt: "2026-11-27T01:00:00.000Z",
	});
	assert.equal(outcome.activated, true);
	assert.equal(outcome.manifest.state, "active");
	assert.equal(outcome.manifest.activatedAt, "2026-11-27T01:00:00.000Z");
});

test("a generation is cleaned only after the activation and the retention window", () => {
	const manifest = {
		schemaVersion: 1,
		namespace: scope.namespace,
		graph: scope.graph,
		sourceSnapshot: "digest-0",
		embeddingModel: "text-embedding-3-small",
		embeddingDimensions: 1536,
		indexedCount: 1,
		runId: "run-0",
		state: "active",
		createdAt: "2026-11-26T00:00:00.000Z",
		activatedAt: "2026-11-26T00:00:00.000Z",
	};
	const obsolete = obsoleteGenerations({
		generations: [manifest],
		activeRunId: "run-1",
		retentionMs: 1000 * 60 * 60 * 24,
		now: "2026-11-26T12:00:00.000Z",
	});
	assert.equal(obsolete.length, 0, "the window has not passed");
	const later = obsoleteGenerations({
		generations: [manifest],
		activeRunId: "run-1",
		retentionMs: 1000 * 60 * 60,
		now: "2026-11-27T02:00:00.000Z",
	});
	assert.equal(later.length, 1);
	const active = obsoleteGenerations({
		generations: [manifest],
		activeRunId: "run-0",
		retentionMs: 0,
		now: "2026-11-27T02:00:00.000Z",
	});
	assert.equal(active.length, 0, "the active generation is never cleaned");
});

test("a catalog that changes during the scan is never a consistent snapshot", () => {
	assert.equal(stableSnapshot(["a", "a", "a"]).stable, true);
	assert.equal(stableSnapshot(["a", "b"]).stable, false);
	assert.equal(stableSnapshot(["a"]).stable, false);
});

test("the payload holds the discovery metadata and never the instructions", () => {
	const payload = indexPayload({
		entry: entry({ tags: ["release", "deploy"] }),
		scope,
	});
	assert.equal(payload.name, "deploy");
	assert.equal(payload.tags, "release,deploy");
	assert.equal(payload.revision, "pub-1");
	assert.equal(payload.namespace, "org-a");
	assert.ok(payload.identity.length > 0);
	assert.equal(
		Object.keys(payload).some((key) => /instruction|body|text/i.test(key)),
		false,
		"the instructions never enter the index",
	);
});
