/**
 * The context of a task, budgeted.
 *
 * The tests prove the rules of the selection: the room is reserved before
 * the budget of the skills, a mandatory dependency counts in both budgets,
 * a skill is never truncated, a required set that does not fit blocks the
 * selection and every selection keeps its citation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { selectContext } from "../harness/skill-context.ts";

/** A reference of a test. */
function refOf(id, overrides = {}) {
	return {
		namespace: "org-a",
		graph: "skills",
		id,
		revision: "pub-1",
		sha256: "a".repeat(64),
		...overrides,
	};
}

/** A candidate of a test. */
function candidate(id, overrides = {}) {
	return {
		ref: refOf(id),
		name: id,
		instructions: `${id} instructions`,
		rank: 1,
		reason: "the wording of the task fits",
		...overrides,
	};
}

test("the room of the conversation is reserved before the budget of the skills", () => {
	const selection = selectContext({
		candidates: [candidate("a")],
		budget: {
			totalTokens: 1000,
			reservedTokens: 400,
			selectionCap: 10,
		},
	});
	assert.equal(selection.budget.availableTokens, 600);
	assert.equal(selection.budget.reservedTokens, 400);
	assert.equal(selection.budget.remainingTokens, 600 - selection.budget.usedTokens);
});

test("a skill that does not fit stays out and is never truncated", () => {
	const selection = selectContext({
		candidates: [candidate("a", { instructions: "x".repeat(8000) })],
		budget: {
			totalTokens: 1000,
			reservedTokens: 0,
			selectionCap: 10,
		},
	});
	assert.equal(selection.selected.length, 0);
	assert.equal(selection.excluded.length, 1);
	assert.match(selection.excluded[0].reason, /budget/);
	assert.equal(
		selection.excluded[0].reason.includes("x".repeat(100)),
		false,
		"the reason never carries the body of the skill",
	);
});

test("a required set that does not fit blocks the selection with a reason", () => {
	const selection = selectContext({
		candidates: [
			candidate("a", { instructions: "x".repeat(8000), required: true }),
		],
		budget: {
			totalTokens: 1000,
			reservedTokens: 0,
			selectionCap: 10,
		},
	});
	assert.equal(selection.verification, "blocked");
	assert.match(selection.blocked, /mandatory skill "a"/);
});

test("a mandatory dependency counts in the cap and in the budget", () => {
	const selection = selectContext({
		candidates: [candidate("a", { rank: 1 })],
		relations: [{ identity: "org-a/skills/dependency", required: true, depth: 1 }],
		budget: {
			totalTokens: 1000,
			reservedTokens: 0,
			selectionCap: 10,
		},
	});
	// The relation names a dependency that is not among the candidates: the
	// mandatory dependency of the closure is missing, so the selection is
	// blocked.
	assert.equal(selection.verification, "blocked");
	assert.match(selection.blocked, /mandatory dependency/);
});

test("the same skill is never loaded twice", () => {
	const selection = selectContext({
		candidates: [
			candidate("a", { rank: 1 }),
			candidate("a", { rank: 2, instructions: "other instructions" }),
		],
		budget: {
			totalTokens: 1000,
			reservedTokens: 0,
			selectionCap: 10,
		},
	});
	assert.equal(selection.selected.length, 1);
	assert.equal(selection.excluded.length, 1);
	assert.match(selection.excluded[0].reason, /already in the context/);
});

test("a changed hash is a different skill and is loaded again", () => {
	const selection = selectContext({
		candidates: [
			candidate("a", { rank: 1 }),
			candidate("a", { rank: 2, ref: refOf("a", { sha256: "b".repeat(64) }) }),
		],
		budget: {
			totalTokens: 1000,
			reservedTokens: 0,
			selectionCap: 10,
		},
	});
	assert.equal(selection.selected.length, 2);
});

test("every selection keeps its citation", () => {
	const selection = selectContext({
		candidates: [
			candidate("a", { reason: "the wording of the task fits", resourcePaths: ["docs/a.md"] }),
		],
		budget: {
			totalTokens: 1000,
			reservedTokens: 0,
			selectionCap: 10,
		},
	});
	assert.equal(selection.selected[0].reason, "the wording of the task fits");
	assert.deepEqual(selection.selected[0].resourcePaths, ["docs/a.md"]);
	assert.equal(selection.selected[0].ref.id, "a");
	assert.ok(selection.selected[0].tokens > 0);
});

test("the optional skills follow the order of the retrieval until the cap", () => {
	const selection = selectContext({
		candidates: [
			candidate("a", { rank: 1 }),
			candidate("b", { rank: 2 }),
			candidate("c", { rank: 3 }),
		],
		budget: {
			totalTokens: 1000,
			reservedTokens: 0,
			selectionCap: 2,
		},
	});
	assert.deepEqual(
		selection.selected.map((skill) => skill.name),
		["a", "b"],
	);
	assert.equal(selection.excluded.length, 1);
	assert.match(selection.excluded[0].reason, /cap of 2 skills/);
});

test("a mandatory dependency loads before the optional skills", () => {
	const selection = selectContext({
		candidates: [
			candidate("optional", { rank: 1 }),
			candidate("mandatory", { rank: 5, required: true }),
		],
		budget: {
			totalTokens: 1000,
			reservedTokens: 0,
			selectionCap: 10,
		},
	});
	assert.equal(selection.selected[0].name, "mandatory");
});
