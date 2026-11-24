/**
 * The snapshot of the exploration checkpoint.
 *
 * A compaction replaces the state of the request with a snapshot, and the
 * state comes back from it. The identifiers of the handoff that the
 * request works on are evidence, and the evidence has to survive the
 * snapshot: a restored request that lost them would name no issue of the
 * store, and the work of the handoff would look like work that names
 * nothing.
 *
 * The tests use the shipped artifact of the package: no program of the
 * machine is called and no model is asked anything.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	createState,
	fromCompactCheckpoint,
	toCompactCheckpoint,
} from "../packages/exploration-guard/dist/index.js";

/** The state of a request that works on a handoff of the store. */
function stateOfHandoff() {
	const state = createState(
		{
			workspace: "/home/frappe/project",
			sessionId: "session-1",
			generation: "gen-1",
			phase: "implementation",
			todoId: 3,
		},
		1000,
	);
	state.checkpoint = {
		findings: [{ statement: "the reset lives in the provider" }],
		hypotheses: [],
		openQuestions: [],
		nextAction: "read the reset parser",
		revision: 1,
		bdIssueId: "bd-67",
		handoffId: "h1",
		correlationId: "c1",
	};
	state.checkpointRevision = 1;
	return state;
}

test("the identifiers of a handoff survive the snapshot", () => {
	const state = stateOfHandoff();
	const snapshot = toCompactCheckpoint(state, Date.now());

	assert.equal(snapshot.bdIssueId, "bd-67");
	assert.equal(snapshot.handoffId, "h1");
	assert.equal(snapshot.correlationId, "c1");

	const restored = fromCompactCheckpoint(snapshot, state);

	assert.equal(restored.checkpoint.bdIssueId, "bd-67");
	assert.equal(restored.checkpoint.handoffId, "h1");
	assert.equal(restored.checkpoint.correlationId, "c1");
	// The rest of the checkpoint comes back as well: the identifiers are
	// not the only thing the snapshot carries.
	assert.equal(restored.checkpoint.nextAction, "read the reset parser");
	assert.equal(restored.checkpointRevision, 1);
});

test("a snapshot of a request without a handoff names no issue", () => {
	const state = createState(
		{
			workspace: "/home/frappe/project",
			sessionId: "session-1",
			generation: "gen-1",
			phase: "implementation",
			todoId: 3,
		},
		1000,
	);
	const snapshot = toCompactCheckpoint(state, Date.now());
	assert.equal(snapshot.bdIssueId, undefined);
	assert.equal(snapshot.handoffId, undefined);
	assert.equal(snapshot.correlationId, undefined);

	const restored = fromCompactCheckpoint(snapshot, state);
	assert.equal(restored.checkpoint.bdIssueId, undefined);
	assert.equal(restored.checkpoint.handoffId, undefined);
	assert.equal(restored.checkpoint.correlationId, undefined);
});
