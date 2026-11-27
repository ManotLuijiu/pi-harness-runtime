/**
 * The retrieval of the skills of the graph.
 *
 * The tests are behavioural: they drive the retrieval with a catalog and a
 * set of vector hits and count what comes back - the candidates, the
 * exclusions and the reasons. A stale hit of the index, a revoked skill and a
 * refused approval have to be visible in the outcome, not in the source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	DEFAULT_FUSION_K,
	SkillContractError,
	exactCandidates,
	lexicalCandidates,
	reciprocalRankFusion,
	searchSkills,
	skillIdentity,
	skillPointId,
	skillRefOf,
	validateIndexManifest,
	validateSkillRef,
} from "../harness/skill-retrieval.ts";

import {
	PILOT_CATALOG,
	PILOT_QUERIES,
} from "./fixtures/skill-catalog.mjs";

const scope = { namespace: "ns-primary", graph: "skills" };

const search = (overrides = {}) =>
	searchSkills({
		query: "deploy",
		namespace: scope.namespace,
		graph: scope.graph,
		catalog: PILOT_CATALOG,
		...overrides,
	});

test("the exact match comes first", () => {
	const outcome = search({ query: "deploy" });
	assert.equal(outcome.mode, "lexical", "the catalog is the path that answered");
	assert.equal(outcome.candidates[0].ref.id, "sk-deploy");
	assert.deepEqual(outcome.candidates[0].methods, ["exact"]);
	assert.equal(outcome.candidates[0].ref.revision, "pub-2026-11-20");
	assert.ok(
		outcome.candidates.some((candidate) => candidate.ref.id === "sk-deploy-runbook"),
		"the other candidates of the request follow the exact match",
	);
});

test("an exact match of an id works as well", () => {
	const outcome = search({ query: "sk-release" });
	assert.equal(outcome.candidates[0].ref.id, "sk-release");
	assert.deepEqual(outcome.candidates[0].methods, ["exact"]);
});

test("the lexical search finds a skill of a different wording", () => {
	const outcome = search({ query: "publish a release of the package" });
	assert.ok(outcome.candidates.some((candidate) => candidate.ref.id === "sk-release"));
});

test("the fusion puts a candidate that two methods find above one that a single method finds", () => {
	const outcome = search({
		query: "deploy the service",
		vectorHits: [
			{ id: "sk-deploy-runbook", score: 0.71 },
			{ id: "sk-frontend", score: 0.82 },
		],
	});
	const ids = outcome.candidates.map((candidate) => candidate.ref.id);
	const both = ids.indexOf("sk-deploy-runbook");
	const single = ids.indexOf("sk-frontend");
	assert.ok(both >= 0 && single >= 0, "both candidates have to be found");
	assert.ok(both < single, "the candidate that two methods found comes first");
	assert.deepEqual(outcome.candidates[both].methods.sort(), ["lexical", "vector"]);
	assert.equal(outcome.mode, "hybrid");
});

test("the raw scores of the methods never decide the order", () => {
	const fused = reciprocalRankFusion([["a", "b"], ["c", "a"]]);
	assert.ok(fused.get("a") > fused.get("b"));
	assert.ok(fused.get("a") > fused.get("c"));
	assert.equal(DEFAULT_FUSION_K, 60);
});

test("a stale hit of the index returns the fresh reference of the catalog", () => {
	const outcome = search({
		query: "the history of the releases",
		vectorHits: [
			{ id: "sk-changelog", score: 0.9, revision: "pub-2026-10-01", sha256: "old" },
		],
	});
	const candidate = outcome.candidates.find((item) => item.ref.id === "sk-changelog");
	assert.ok(candidate, "the skill of the stale hit is found");
	assert.equal(candidate.ref.revision, "pub-2026-11-20", "the reference is the one of the catalog");
	assert.equal(candidate.staleIndex, true);
	assert.ok(candidate.notes?.length, "the stale condition is recorded");
});

test("a revoked skill is left out with a reason", () => {
	const outcome = search({
		query: "legacy deploy",
		vectorHits: [{ id: "sk-revoked", score: 0.99 }],
	});
	assert.ok(!outcome.candidates.some((candidate) => candidate.ref.id === "sk-revoked"));
	const exclusion = outcome.excluded.find((item) => item.id === "sk-revoked");
	assert.ok(exclusion, "the revoked skill is reported");
	assert.match(exclusion.reason, /revoked/);
});

test("a skill of a revision that is not approved is left out", () => {
	const outcome = search({
		query: "review a diff",
		approvedRevision: "pub-2026-11-20",
	});
	const ids = outcome.candidates.map((candidate) => candidate.ref.id);
	assert.ok(ids.includes("sk-review"));
	assert.ok(!ids.includes("sk-review-old"), "the old revision is not allowed");
	assert.ok(
		outcome.excluded.some((item) => item.reason.includes("not approved")),
		"the reason of the exclusion is named",
	);
});

test("a skill with an invalid hash is left out", () => {
	const outcome = search({
		query: "broken hash",
		vectorHits: [{ id: "sk-broken-hash", score: 0.99 }],
	});
	assert.ok(!outcome.candidates.some((candidate) => candidate.ref.id === "sk-broken-hash"));
	assert.ok(
		outcome.excluded.some((item) => item.id === "sk-broken-hash"),
		"the broken skill is reported",
	);
});

test("a skill the catalog does not hold any more is left out", () => {
	const outcome = search({
		query: "quiet skill",
		vectorHits: [{ id: "sk-deleted", score: 0.99 }],
	});
	assert.ok(
		outcome.excluded.some((item) => item.id === "sk-deleted"),
		"the deleted skill is reported",
	);
});

test("two skills with the same name in two namespaces stay two skills", () => {
	const catalog = [
		{ id: "a-1", name: "review", description: "the review of the first scope", revision: "pub-1", sha256: "a".repeat(64) },
		{ id: "b-1", name: "review", description: "the review of the second scope", revision: "pub-1", sha256: "b".repeat(64) },
	];
	const first = searchSkills({
		query: "the review of the first scope",
		namespace: "ns-a",
		graph: "skills",
		catalog,
	});
	const second = searchSkills({
		query: "the review of the first scope",
		namespace: "ns-b",
		graph: "skills",
		catalog,
	});
	assert.equal(first.candidates[0].ref.id, "a-1");
	assert.equal(second.candidates[0].ref.id, "a-1");
	assert.notEqual(
		skillIdentity(skillRefOf(catalog[0], { namespace: "ns-a", graph: "skills" })),
		skillIdentity(skillRefOf(catalog[0], { namespace: "ns-b", graph: "skills" })),
		"the scope is part of the identity",
	);
});

test("the deduplication happens on the identity, not on the name", () => {
	const outcome = search({
		query: "review",
		vectorHits: [{ id: "sk-review", score: 0.9 }],
	});
	const ids = outcome.candidates.map((candidate) => candidate.ref.id);
	assert.equal(new Set(ids).size, ids.length, "no candidate appears twice");
});

test("the point id of a reference is a stable uuid of the scope", () => {
	const ref = skillRefOf(PILOT_CATALOG[0], scope);
	const id = skillPointId(ref);
	assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	assert.equal(id, skillPointId(ref), "the id is stable");
	const other = skillPointId(skillRefOf(PILOT_CATALOG[0], { namespace: "ns-other", graph: "skills" }));
	assert.notEqual(id, other, "two scopes never share a point");
});

test("the contract rejects a reference that is not a reference", () => {
	assert.throws(() => validateSkillRef(null), SkillContractError);
	assert.throws(() => validateSkillRef({ namespace: "n" }), SkillContractError);
	assert.throws(
		() => validateSkillRef({ namespace: "n", graph: "g", id: "i", revision: "r", sha256: "no-hash" }),
		SkillContractError,
	);
	const ref = validateSkillRef({
		namespace: "n",
		graph: "g",
		id: "i",
		revision: "r",
		sha256: "A".repeat(64),
	});
	assert.equal(ref.sha256, "a".repeat(64), "the hash is normalized");
});

test("the contract rejects a manifest that does not describe a generation", () => {
	assert.throws(() => validateIndexManifest({}), SkillContractError);
	assert.throws(
		() => validateIndexManifest({ ...validManifest(), embeddingDimensions: 0 }),
		SkillContractError,
	);
	assert.throws(
		() => validateIndexManifest({ ...validManifest(), state: "unknown" }),
		SkillContractError,
	);
	assert.equal(validateIndexManifest(validManifest()).schemaVersion, 1);
});

function validManifest() {
	return {
		schemaVersion: 1,
		namespace: "ns-primary",
		graph: "skills",
		sourceSnapshot: "pub-2026-11-20",
		embeddingModel: "text-embedding-3-small",
		embeddingDimensions: 1536,
		indexedCount: 30,
		runId: "run-1",
		state: "active",
		createdAt: "2026-11-20T00:00:00.000Z",
	};
}

test("an empty result has a reason and is not an error", () => {
	const outcome = search({ query: "kubernetes" });
	assert.equal(outcome.mode, "empty");
	assert.equal(outcome.candidates.length, 0);
	assert.match(outcome.reasons.empty, /no skill/);
});

test("an unavailable index degrades the search and keeps the lexical path", () => {
	const outcome = search({
		query: "the cause of a failure",
		vectorUnavailable: "the vector index could not be reached",
	});
	assert.equal(outcome.mode, "lexical");
	assert.ok(outcome.candidates.some((candidate) => candidate.ref.id === "sk-debug"));
	assert.match(outcome.reasons.degraded, /could not be reached/);
});

test("the state of the index says that it is behind the catalog", () => {
	const behind = search({
		query: "deploy",
		indexManifest: validManifest(),
	});
	assert.equal(behind.index?.stale, false, "the snapshot of the manifest is in the catalog");

	const outdated = search({
		query: "deploy",
		indexManifest: { ...validManifest(), sourceSnapshot: "pub-2020-01-01" },
	});
	assert.equal(outdated.index?.stale, true, "the index is behind the catalog");
});

test("the candidates of the pilot are found", () => {
	const misses = [];
	for (const item of PILOT_QUERIES) {
		const outcome = searchSkills({
			query: item.query,
			namespace: scope.namespace,
			graph: scope.graph,
			catalog: PILOT_CATALOG,
		});
		const ids = outcome.candidates.map((candidate) => candidate.ref.id);
		for (const expected of item.expected) {
			if (!ids.includes(expected)) misses.push(`${item.query} -> ${expected}`);
		}
		for (const forbidden of item.forbidden) {
			if (ids.includes(forbidden)) misses.push(`${item.query} -> forbidden ${forbidden}`);
		}
	}
	assert.deepEqual(misses, [], "every relevant skill is found and no forbidden skill is selected");
});

test("the lexical baseline finds at least as much as the fusion", () => {
	let lexicalHits = 0;
	let fusedHits = 0;
	for (const item of PILOT_QUERIES) {
		const lexical = lexicalCandidates(PILOT_CATALOG, item.query, 10).map((hit) => hit.entry.id);
		const fused = searchSkills({
			query: item.query,
			namespace: scope.namespace,
			graph: scope.graph,
			catalog: PILOT_CATALOG,
		}).candidates.map((candidate) => candidate.ref.id);
		lexicalHits += item.expected.filter((id) => lexical.includes(id)).length;
		fusedHits += item.expected.filter((id) => fused.includes(id)).length;
	}
	assert.ok(
		fusedHits >= lexicalHits,
		`the fusion finds ${fusedHits}, the lexical baseline ${lexicalHits}`,
	);
});

test("the exact candidates are the ones that match the name exactly", () => {
	const exact = exactCandidates(PILOT_CATALOG, "DEPLOY");
	assert.deepEqual(exact.map((entry) => entry.id), ["sk-deploy"]);
});
