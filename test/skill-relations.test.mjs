/**
 * The relationships of the graph, bounded.
 *
 * The tests prove the bounds and the refusals of the expansion: the
 * inferred edges are never trusted, the expansion is bounded, the cycles
 * are detected, the missing dependencies are named, the conflicts are not
 * resolved by a score and the prerequisites load before the dependents.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	loadOrder,
	planRelations,
	trustedEdges,
} from "../harness/skill-relations.ts";

/** An edge of a test. */
function edge(overrides = {}) {
	return {
		from: "skill-a",
		to: "skill-b",
		type: "requires",
		provenance: "published",
		revision: "pub-1",
		...overrides,
	};
}

/** A reader of a fixed set of edges. */
function readerOf(edges) {
	return {
		async neighbors(identity, options) {
			return edges
				.filter((item) => item.from === identity || item.to === identity)
				.filter((item) => options.types.includes(item.type))
				.slice(0, options.limit);
		},
	};
}

test("an edge that a model inferred is never trusted", () => {
	const edges = [
		edge({ provenance: "published" }),
		edge({ provenance: "reviewed" }),
		edge({ provenance: "inferred" }),
	];
	assert.equal(trustedEdges(edges).length, 2);
});

test("a mandatory prerequisite is found and loads before the dependent", async () => {
	const plan = await planRelations({
		roots: [{ identity: "skill-a", name: "a" }],
		reader: readerOf([edge({ from: "skill-a", to: "skill-b" })]),
		types: ["requires"],
	});
	assert.equal(plan.nodes.length, 2);
	assert.equal(plan.nodes[0].identity, "skill-b", "the prerequisite loads first");
	assert.equal(plan.nodes[0].required, true);
	assert.equal(plan.nodes[1].identity, "skill-a");
	assert.equal(plan.ok, true);
});

test("the expansion is bounded by the number of the nodes", async () => {
	const edges = Array.from({ length: 10 }, (_, index) =>
		edge({ from: "skill-a", to: `skill-${index}` }),
	);
	const plan = await planRelations({
		roots: [{ identity: "skill-a" }],
		reader: readerOf(edges),
		types: ["requires"],
		limits: { nodes: 3, neighbours: 10 },
	});
	assert.ok(plan.nodes.length <= 3);
	assert.ok(plan.truncated.length > 0);
	assert.match(plan.truncated[0].reason, /limit of 3 nodes/);
});

test("the expansion is bounded by the depth", async () => {
	const edges = [
		edge({ from: "skill-a", to: "skill-b" }),
		edge({ from: "skill-b", to: "skill-c" }),
		edge({ from: "skill-c", to: "skill-d" }),
	];
	const plan = await planRelations({
		roots: [{ identity: "skill-a" }],
		reader: readerOf(edges),
		types: ["requires"],
		limits: { depth: 2, nodes: 20 },
	});
	assert.deepEqual(
		plan.nodes.map((node) => node.identity),
		["skill-c", "skill-b", "skill-a"],
		"the prerequisites load before the dependents",
	);
	assert.ok(plan.truncated.some((item) => item.reason.includes("depth of 2")));
});

test("the expansion is bounded by the budget of the tokens", async () => {
	const edges = [
		edge({ from: "skill-a", to: "skill-b" }),
		edge({ from: "skill-a", to: "skill-c" }),
	];
	const plan = await planRelations({
		roots: [{ identity: "skill-a" }],
		reader: readerOf(edges),
		types: ["requires"],
		limits: { tokens: 10, nodes: 20 },
		costOf: () => 6,
	});
	assert.ok(plan.tokens <= 10);
	assert.ok(plan.truncated.some((item) => item.reason.includes("budget of 10 tokens")));
});

test("a cycle is detected and named", async () => {
	const edges = [
		edge({ from: "skill-a", to: "skill-b" }),
		edge({ from: "skill-b", to: "skill-a" }),
	];
	const plan = await planRelations({
		roots: [{ identity: "skill-a" }],
		reader: readerOf(edges),
		types: ["requires"],
	});
	assert.ok(plan.cycles.length > 0);
	assert.equal(plan.ok, false);
});

test("a dependency that cannot be read is named and blocks the plan", async () => {
	const plan = await planRelations({
		roots: [{ identity: "skill-a" }],
		reader: {
			async neighbors() {
				throw new Error("the credential was refused");
			},
		},
		types: ["requires"],
	});
	assert.equal(plan.missing.length, 1);
	assert.match(plan.missing[0].reason, /credential was refused/);
	assert.equal(plan.ok, false);
});

test("a conflict of two mandatory instructions is not resolved by a score", async () => {
	const plan = await planRelations({
		roots: [{ identity: "skill-a" }],
		reader: readerOf([
			edge({ from: "skill-a", to: "skill-b", type: "conflicts_with" }),
		]),
		types: ["requires", "conflicts_with"],
	});
	assert.equal(plan.conflicts.length, 1);
	assert.equal(plan.conflicts[0].b, "skill-b");
	assert.equal(plan.ok, false);
});

test("an optional neighbour is found but is never mandatory", async () => {
	const plan = await planRelations({
		roots: [{ identity: "skill-a" }],
		reader: readerOf([
			edge({ from: "skill-a", to: "skill-b", type: "related_to" }),
		]),
		types: ["related_to"],
	});
	assert.equal(plan.nodes.length, 2);
	assert.equal(plan.nodes.find((node) => node.identity === "skill-b").required, false);
});

test("the order of the load puts every prerequisite before its dependent", () => {
	const nodes = [
		{ identity: "c", required: true, depth: 1 },
		{ identity: "a", required: true, depth: 0 },
		{ identity: "b", required: true, depth: 1 },
	];
	const order = loadOrder(nodes, [edge({ from: "b", to: "c" })]);
	assert.equal(order[0].identity, "c");
	assert.ok(order.findIndex((node) => node.identity === "b") > 0);
});
