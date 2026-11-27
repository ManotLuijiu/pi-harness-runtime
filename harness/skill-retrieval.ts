/**
 * The retrieval of the skills of the graph.
 *
 * OmniGraph owns the published skills and their relationships. Qdrant is a
 * rebuildable search index: it may FIND a skill, but it never decides what a
 * skill says and it never authorises one.
 *
 * The rules of this module:
 *
 * - every candidate is verified against the authoritative catalog before it
 *   leaves: the membership, the revision, the hash and the approval scope.
 *   A hit of the vector index that does not match the catalog identifies a
 *   skill, but only the fresh, verified reference of the catalog is returned,
 * - a cosine similarity is a number, not a probability. The candidates of the
 *   different methods are fused with a declared rank fusion, never with a
 *   comparison of raw scores,
 * - the deduplication happens on the authoritative identity, not on the name:
 *   two skills of two namespaces may share a name and stay two skills,
 * - every outcome has a reason. An empty result, an unavailable index and a
 *   refused credential are three different answers.
 */

import { createHash } from "node:crypto";

/** The methods a candidate can be found by. */
export type RetrievalMethod = "exact" | "lexical" | "vector" | "relation";

/** The state of an index generation. */
export type IndexState = "building" | "active" | "retired";

/** The failure of a contract. */
export class SkillContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SkillContractError";
	}
}

/**
 * The authoritative reference of a skill.
 *
 * The reference is the identity of a skill in one scope: the namespace of
 * the source, the graph, the id of the skill, the revision of the
 * publication it belongs to and the hash of its instructions.
 */
export interface SkillRef {
	/** The scope of the source (the access scope of the client). */
	namespace: string;
	/** The graph that holds the skill. */
	graph: string;
	/** The id the graph knows the skill by. */
	id: string;
	/** The revision of the publication the skill belongs to. */
	revision: string;
	/** The hash of the instructions of the skill. */
	sha256: string;
}

/**
 * The manifest of an index generation.
 *
 * A change of the schema, of the source snapshot or of the embedding model
 * needs a new generation: the readers compare the manifest with the one they
 * expect and refuse a generation they do not know.
 */
export interface IndexManifest {
	/** The version of the schema of the manifest. */
	schemaVersion: number;
	/** The scope of the source the index was built from. */
	namespace: string;
	/** The graph the index was built from. */
	graph: string;
	/** The digest of the snapshot of the source. */
	sourceSnapshot: string;
	/** The model that produced the embeddings. */
	embeddingModel: string;
	/** The number of dimensions of the embeddings. */
	embeddingDimensions: number;
	/** The number of indexed records. */
	indexedCount: number;
	/** The run that built the generation. */
	runId: string;
	/** The state of the generation. */
	state: IndexState;
	/** When the generation was built. */
	createdAt: string;
	/** When the generation was activated. */
	activatedAt?: string;
}

/** One entry of the authoritative catalog. */
export interface CatalogEntry {
	/** The id the graph knows the skill by. */
	id: string;
	/** The name of the skill. */
	name: string;
	/** The description of the skill (discovery metadata). */
	description: string;
	/** The revision of the publication the skill belongs to. */
	revision: string;
	/** The hash of the instructions of the skill. */
	sha256: string;
	/** The skill was revoked in the snapshot the catalog was read from. */
	revoked?: boolean;
}

/** A candidate of the retrieval, with the method that found it. */
export interface Candidate {
	/** The authoritative reference of the skill. */
	ref: SkillRef;
	/** The name of the skill (discovery metadata). */
	name: string;
	/** The description of the skill (discovery metadata). */
	description: string;
	/** The methods that found the candidate. */
	methods: RetrievalMethod[];
	/** The scores of the methods and the fused score. */
	scores: {
		exact?: number;
		lexical?: number;
		vector?: number;
		fused: number;
	};
	/** The place of the candidate in the result. */
	rank: number;
	/** The index knew an older revision of this skill. */
	staleIndex?: boolean;
	/** The reasons of the verification, for the operator. */
	notes?: string[];
}

/** Why a candidate was left out. */
export interface ExcludedCandidate {
	/** The id of the skill. */
	id: string;
	/** The reason of the exclusion. */
	reason: string;
}

/** The reasons of an outcome. */
export interface RetrievalReasons {
	/** The catalog holds nothing that fits. */
	empty?: string;
	/** The index could not be reached. */
	unavailable?: string;
	/** The credential was refused. */
	denied?: string;
	/** The retrieval ran with less than the full method. */
	degraded?: string;
	/** The index was compared with the lexical search, and its candidates were left out. */
	shadow?: string;
}

/** The outcome of a retrieval. */
export interface RetrievalOutcome {
	/** The mode of the retrieval. */
	mode: "exact" | "lexical" | "vector" | "hybrid" | "empty";
	/** The candidates, verified against the catalog. */
	candidates: Candidate[];
	/** The candidates that were left out. */
	excluded: ExcludedCandidate[];
	/** The reasons of the outcome. */
	reasons: RetrievalReasons;
	/** The state of the index, when one was used. */
	index?: {
		manifest?: IndexManifest;
		/** The index is behind the catalog. */
		stale: boolean;
	};
	/** The expansion of the relations, when one was read. */
	relations?: {
		/** The nodes of the expansion. */
		nodes: Array<{ identity: string; required: boolean; depth: number }>;
		/** The cycles the expansion found. */
		cycles: string[][];
		/** The conflicts of the mandatory instructions. */
		conflicts: Array<{ a: string; b: string; reason: string }>;
		/** The dependencies that are missing or denied. */
		missing: Array<{ identity: string; reason: string }>;
	};
}

/** A hit of the vector index. */
export interface VectorHit {
	/** The id of the skill in the index. */
	id: string;
	/** The similarity of the hit. */
	score: number;
	/** The revision the index knew. */
	revision?: string;
	/** The hash the index knew. */
	sha256?: string;
}

/** The options of a retrieval. */
export interface RetrievalOptions {
	/** The wording of the request. */
	query: string;
	/** The scope of the source. */
	namespace: string;
	/** The graph that holds the skills. */
	graph: string;
	/** The authoritative catalog. */
	catalog: CatalogEntry[];
	/** The revision the operator approved, if any. */
	approvedRevision?: string;
	/** How many candidates to return. */
	limit?: number;
	/** The hits of the vector index, when one was consulted. */
	vectorHits?: VectorHit[];
	/** The reason the vector index could not be used. */
	vectorUnavailable?: string;
	/** The manifest of the index, when one was used. */
	indexManifest?: IndexManifest;
}

/** The default number of candidates. */
export const DEFAULT_RETRIEVAL_LIMIT = 20;

/** The constant of the rank fusion. A larger value flattens the differences. */
export const DEFAULT_FUSION_K = 60;

/** The hash of a publication. */
const PUBLICATION_HASH = /^[0-9a-f]{64}$/;

/**
 * The reference of a catalog entry.
 *
 * @param entry The entry of the authoritative catalog.
 * @param scope The scope of the source and the graph.
 */
export function skillRefOf(
	entry: CatalogEntry,
	scope: { namespace: string; graph: string },
): SkillRef {
	return {
		namespace: scope.namespace,
		graph: scope.graph,
		id: entry.id,
		revision: entry.revision,
		sha256: entry.sha256,
	};
}

/**
 * The identity of a reference, as one string.
 *
 * The identity is the scope, the graph and the id: the revision and the hash
 * change with every publication, the identity does not.
 */
export function skillIdentity(ref: SkillRef): string {
	return `${ref.namespace}::${ref.graph}::${ref.id}`;
}

/**
 * The point id of a reference in a vector store.
 *
 * The id is a UUID that is derived from the identity, so two scopes never
 * share a point and a truncated hash is never used as a number. The identity
 * itself stays in the payload and is verified on every read.
 */
export function skillPointId(ref: SkillRef): string {
	const digest = createHash("sha256")
		.update(skillIdentity(ref), "utf8")
		.digest();
	// The UUID version 5 (a name based UUID) with the SHA-1 namespace of
	// the UUID itself. The digest is folded into 16 bytes.
	const bytes = Buffer.from(digest.subarray(0, 16));
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Validate a reference that comes from outside.
 *
 * @param value The value to validate.
 */
export function validateSkillRef(value: unknown): SkillRef {
	if (!value || typeof value !== "object") {
		throw new SkillContractError("a skill reference has to be an object");
	}
	const ref = value as Record<string, unknown>;
	for (const key of ["namespace", "graph", "id", "revision", "sha256"] as const) {
		if (typeof ref[key] !== "string" || !ref[key]) {
			throw new SkillContractError(`the skill reference needs a ${key}`);
		}
	}
	if (!PUBLICATION_HASH.test(String(ref.sha256).toLowerCase())) {
		throw new SkillContractError(
			"the skill reference needs the hash of the publication",
		);
	}
	return {
		namespace: String(ref.namespace),
		graph: String(ref.graph),
		id: String(ref.id),
		revision: String(ref.revision),
		sha256: String(ref.sha256).toLowerCase(),
	};
}

/**
 * Validate a manifest that comes from outside.
 *
 * @param value The value to validate.
 */
export function validateIndexManifest(value: unknown): IndexManifest {
	if (!value || typeof value !== "object") {
		throw new SkillContractError("an index manifest has to be an object");
	}
	const manifest = value as Record<string, unknown>;
	const numbers: Array<[string, number, number]> = [
		["schemaVersion", Number(manifest.schemaVersion), 1],
		["embeddingDimensions", Number(manifest.embeddingDimensions), 1],
		["indexedCount", Number(manifest.indexedCount), 0],
	];
	for (const [key, number, smallest] of numbers) {
		if (!Number.isInteger(number) || number < smallest) {
			throw new SkillContractError(`the index manifest needs a ${key}`);
		}
	}
	for (const key of [
		"namespace",
		"graph",
		"sourceSnapshot",
		"embeddingModel",
		"runId",
		"state",
		"createdAt",
	] as const) {
		if (typeof manifest[key] !== "string" || !manifest[key]) {
			throw new SkillContractError(`the index manifest needs a ${key}`);
		}
	}
	if (!["building", "active", "retired"].includes(String(manifest.state))) {
		throw new SkillContractError("the index manifest needs a known state");
	}
	return {
		schemaVersion: Number(manifest.schemaVersion),
		namespace: String(manifest.namespace),
		graph: String(manifest.graph),
		sourceSnapshot: String(manifest.sourceSnapshot),
		embeddingModel: String(manifest.embeddingModel),
		embeddingDimensions: Number(manifest.embeddingDimensions),
		indexedCount: Number(manifest.indexedCount),
		runId: String(manifest.runId),
		state: manifest.state as IndexState,
		createdAt: String(manifest.createdAt),
		...(manifest.activatedAt ? { activatedAt: String(manifest.activatedAt) } : {}),
	};
}

/**
 * The candidates of an exact name or id.
 *
 * @param catalog The authoritative catalog.
 * @param query The wording of the request.
 */
export function exactCandidates(
	catalog: CatalogEntry[],
	query: string,
): CatalogEntry[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];
	return catalog.filter(
		(entry) =>
			entry.name.toLowerCase() === needle || entry.id.toLowerCase() === needle,
	);
}

/** The words that carry no meaning in a search. */
const STOP_WORDS = new Set([
	"after", "above", "all", "and", "any", "are", "because", "been", "before",
	"being", "both", "but", "can", "did", "does", "doing", "down", "during",
	"each", "few", "for", "from", "had", "has", "have", "her", "him", "his",
	"how", "into", "its", "just", "more", "most", "not", "now", "off", "only",
	"other", "out", "over", "own", "same", "she", "should", "some", "such",
	"than", "that", "the", "their", "them", "then", "there", "these", "they",
	"this", "those", "too", "under", "very", "was", "were", "what", "when",
	"where", "which", "while", "who", "whom", "why", "will", "with", "would",
	"you", "your",
]);

/**
 * The candidates of a lexical match, with their rank.
 *
 * The match is over the name, the description and the id of the catalog. The
 * score counts the words of the request that the entry carries; it is a
 * number for the fusion, not a probability. The words that carry no meaning
 * ("the", "of", "to") are left out, so that a common word does not make every
 * entry a candidate.
 *
 * @param catalog The authoritative catalog.
 * @param query The wording of the request.
 * @param limit How many candidates to return.
 */
export function lexicalCandidates(
	catalog: CatalogEntry[],
	query: string,
	limit: number = DEFAULT_RETRIEVAL_LIMIT,
): Array<{ entry: CatalogEntry; score: number }> {
	const words = query
		.toLowerCase()
		.split(/[^a-z0-9]+/i)
		.map((word) => word.trim())
		.filter((word) => word.length > 2 && !STOP_WORDS.has(word));
	if (words.length === 0) return [];
	const scored: Array<{ entry: CatalogEntry; score: number }> = [];
	for (const entry of catalog) {
		const name = entry.name.toLowerCase();
		const description = entry.description.toLowerCase();
		const id = entry.id.toLowerCase();
		let score = 0;
		for (const word of words) {
			if (name === word) score += 4;
			else if (name.includes(word)) score += 2;
			if (id.includes(word)) score += 1;
			if (description.includes(word)) score += 1;
		}
		if (score > 0) scored.push({ entry, score });
	}
	scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
	return scored.slice(0, limit);
}

/**
 * Fuse the rankings of the methods.
 *
 * The fusion is the reciprocal rank fusion: every method contributes
 * 1/(k + rank) to a candidate, so a candidate that several methods find is
 * above a candidate that one method finds. The raw scores of the methods
 * never meet each other: a cosine similarity and a lexical score are not the
 * same kind of number.
 *
 * @param rankings The ids of the candidates of every method, best first.
 * @param k The constant of the fusion.
 */
export function reciprocalRankFusion(
	rankings: string[][],
	k: number = DEFAULT_FUSION_K,
): Map<string, number> {
	const fused = new Map<string, number>();
	for (const ranking of rankings) {
		ranking.forEach((id, index) => {
			fused.set(id, (fused.get(id) ?? 0) + 1 / (k + index + 1));
		});
	}
	return fused;
}

/**
 * Verify a candidate against the authoritative catalog.
 *
 * A candidate is only usable when the catalog holds it, when it is not
 * revoked, when its revision is the one of the catalog, when its hash is the
 * one of the catalog and when the approval of the operator allows it.
 *
 * @param id The id of the candidate.
 * @param catalog The authoritative catalog.
 * @param approvedRevision The revision the operator approved, if any.
 */
export function verifyCandidate(
	id: string,
	catalog: CatalogEntry[],
	approvedRevision?: string,
): { entry?: CatalogEntry; reason?: string } {
	const entry = catalog.find((item) => item.id === id);
	if (!entry) return { reason: "the catalog does not hold the skill any more" };
	if (entry.revoked) return { reason: "the skill was revoked in the publication" };
	if (!entry.revision) return { reason: "the skill has no revision" };
	if (!PUBLICATION_HASH.test(entry.sha256.toLowerCase())) {
		return { reason: "the hash of the publication is not a hash" };
	}
	if (approvedRevision && entry.revision !== approvedRevision) {
		return { reason: "the revision of the skill is not approved" };
	}
	return { entry };
}

/**
 * Find the skills that fit a request.
 *
 * The exact matches come first, then the lexical matches of the catalog and
 * the hits of the vector index are fused. Every candidate is verified
 * against the catalog before it is returned: a hit of the index that does
 * not match the catalog identifies a skill, but only the fresh reference of
 * the catalog is returned.
 *
 * @param options The request and the sources.
 */
export function searchSkills(options: RetrievalOptions): RetrievalOutcome {
	const limit = options.limit && options.limit > 0 ? options.limit : DEFAULT_RETRIEVAL_LIMIT;
	const catalog = options.catalog;
	const scope = { namespace: options.namespace, graph: options.graph };
	const excluded: ExcludedCandidate[] = [];
	const reasons: RetrievalReasons = {};

	if (options.vectorUnavailable) {
		reasons.degraded = options.vectorUnavailable;
	}

	// An empty request lists the catalog. The listing is the contract of
	// the tool: the wording is optional, and the graph shows what it
	// holds.
	if (!options.query.trim()) {
		return {
			mode: "lexical",
			candidates: listCatalog(catalog, scope, limit, options.approvedRevision, excluded),
			excluded,
			reasons,
			index: indexState(options, catalog),
		};
	}

	const lexical = lexicalCandidates(catalog, options.query, limit);
	const vectorHits = options.vectorHits ?? [];
	const lexicalIds = lexical.map((item) => item.entry.id);
	const vectorIds = vectorHits.map((hit) => hit.id);
	const fused = reciprocalRankFusion([lexicalIds, vectorIds]);
	const order = [...fused.entries()].sort((a, b) => b[1] - a[1]);
	const bestFused = order.length > 0 ? order[0][1] : 0;

	const candidates: Candidate[] = [];
	const seen = new Set<string>();

	// The exact match is the answer of the user: it comes first, and the
	// other candidates of the request follow it.
	for (const entry of exactCandidates(catalog, options.query)) {
		const verified = verifyCandidate(entry.id, catalog, options.approvedRevision);
		if (!verified.entry) {
			excluded.push({ id: entry.id, reason: verified.reason ?? "not allowed" });
			continue;
		}
		seen.add(entry.id);
		candidates.push(candidateOf(verified.entry, scope, ["exact"], {
			exact: 1,
			fused: bestFused + 1,
		}));
	}

	for (const [id, score] of order) {
		if (candidates.length >= limit) break;
		if (seen.has(id)) continue;
		seen.add(id);
		const verified = verifyCandidate(id, catalog, options.approvedRevision);
		if (!verified.entry) {
			excluded.push({ id, reason: verified.reason ?? "not allowed" });
			continue;
		}
		const lexicalScore = lexical.find((item) => item.entry.id === id)?.score;
		const vectorHit = vectorHits.find((hit) => hit.id === id);
		const methods: RetrievalMethod[] = [];
		if (lexicalScore !== undefined) methods.push("lexical");
		if (vectorHit) methods.push("vector");
		const candidate = candidateOf(verified.entry, scope, methods, {
			...(lexicalScore !== undefined ? { lexical: lexicalScore } : {}),
			...(vectorHit ? { vector: vectorHit.score } : {}),
			fused: score,
		});
		if (vectorHit && vectorHit.revision !== undefined && vectorHit.revision !== verified.entry.revision) {
			candidate.staleIndex = true;
			candidate.notes = [
				`the index knew revision ${vectorHit.revision} and the catalog holds ${verified.entry.revision}`,
			];
		}
		candidates.push(candidate);
	}

	if (candidates.length === 0) {
		reasons.empty = catalog.length === 0
			? "the catalog holds no skill"
			: "the catalog holds no skill that fits";
		return {
			mode: "empty",
			candidates,
			excluded,
			reasons,
			index: indexState(options, catalog),
		};
	}

	return {
		mode: modeOf(candidates),
		candidates: withRanks(candidates),
		excluded,
		reasons,
		index: indexState(options, catalog),
	};
}

/**
 * The candidates with the place they have in the result.
 */
function withRanks(candidates: Candidate[]): Candidate[] {
	candidates.forEach((candidate, index) => {
		candidate.rank = index + 1;
	});
	return candidates;
}

/**
 * A candidate of the catalog.
 */
function candidateOf(
	entry: CatalogEntry,
	scope: { namespace: string; graph: string },
	methods: RetrievalMethod[],
	scores: Candidate["scores"],
): Candidate {
	return {
		ref: skillRefOf(entry, scope),
		name: entry.name,
		description: entry.description,
		methods,
		scores,
		rank: 0,
	};
}

/**
 * The listing of the catalog.
 */
function listCatalog(
	catalog: CatalogEntry[],
	scope: { namespace: string; graph: string },
	limit: number,
	approvedRevision: string | undefined,
	excluded: ExcludedCandidate[],
): Candidate[] {
	const candidates: Candidate[] = [];
	for (const entry of catalog) {
		if (candidates.length >= limit) break;
		const verified = verifyCandidate(entry.id, catalog, approvedRevision);
		if (!verified.entry) {
			excluded.push({ id: entry.id, reason: verified.reason ?? "not allowed" });
			continue;
		}
		const candidate = candidateOf(verified.entry, scope, ["lexical"], {
			lexical: 0,
			fused: 0,
		});
		candidate.rank = candidates.length + 1;
		candidates.push(candidate);
	}
	return candidates;
}

/**
 * The mode of the retrieval, as the operator sees it.
 */
function modeOf(candidates: Candidate[]): RetrievalOutcome["mode"] {
	const fromCatalog = candidates.some(
		(candidate) =>
			candidate.methods.includes("lexical") || candidate.methods.includes("exact"),
	);
	const fromIndex = candidates.some((candidate) => candidate.methods.includes("vector"));
	if (fromCatalog && fromIndex) return "hybrid";
	if (fromIndex) return "vector";
	return "lexical";
}

/**
 * The state of the index, as the operator sees it.
 *
 * The index is stale when the catalog holds a revision that the manifest of
 * the index does not know. A health check of the vector store is not a proof
 * that the index is synchronized.
 */
function indexState(
	options: RetrievalOptions,
	catalog: CatalogEntry[],
): { manifest?: IndexManifest; stale: boolean } {
	const manifest = options.indexManifest;
	if (!manifest) return { stale: false };
	const revisions = new Set(catalog.map((entry) => entry.revision));
	const stale = !revisions.has(manifest.sourceSnapshot);
	return { manifest, stale };
}
