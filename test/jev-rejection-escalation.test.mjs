/**
 * The escalation of a refusal of the judge.
 *
 * The judge said "no": the human is asked with working buttons, and the
 * work stays blocked until the human answers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	JevRejectionEscalationRuntime,
	buildJevRejectionMessage,
} from "../harness/jev-rejection-escalation.ts";

/** The context of a refusal. */
function context(overrides = {}) {
	return {
		originalRequestId: "q-179494",
		sessionId: "session-1",
		generation: 3,
		workspace: "/home/frappe/project",
		task: "two commits and their push",
		action: "create and push the two described commits",
		reason: "push is premature because required tests are pending",
		blocked: ["push of the two commits"],
		independentWork: "the pending tests may continue",
		...overrides,
	};
}

/**
 * A runtime with a recording of the delivery and the answers.
 */
function makeRuntime(deliverResults, options = {}) {
	const delivered = [];
	const approved = [];
	const rejected = [];
	let counter = 0;
	const runtime = new JevRejectionEscalationRuntime({
		registerQuestion: (ctx) => {
			counter += 1;
			// The escalation gets its own id: the question of the judge is
			// closed, and live buttons on a closed request are a lie.
			assert.notEqual(`escalation-${counter}`, ctx.originalRequestId);
			return `escalation-${counter}`;
		},
		deliver: async (questionId, text) => {
			delivered.push({ questionId, text });
			if (typeof deliverResults === "function") {
				return deliverResults(delivered.length, questionId, text);
			}
			return deliverResults ?? [{ success: true, channel: "telegram" }];
		},
		onApproved: (state) => approved.push(state),
		onRejected: (state) => rejected.push(state),
		// The tests do not wait for a pause between two attempts.
		retryDelayMs: 0,
		...options,
	});
	return { runtime, delivered, approved, rejected };
}

test("the message names the workspace, the task, the action and the reason", () => {
	const message = buildJevRejectionMessage(context());
	assert.match(message, /Jev recommends No: push is premature/);
	assert.match(message, /Workspace: \/home\/frappe\/project/);
	assert.match(message, /Task: two commits and their push/);
	assert.match(message, /Proposed action: create and push the two described commits/);
	assert.match(message, /stays blocked/);
	// The question of the human is unambiguous.
	assert.match(message, /Do you approve this action\? \[Yes\] \[No\]/);
});

test("the message says what may continue", () => {
	const message = buildJevRejectionMessage(context());
	assert.match(message, /the pending tests may continue/);
});

test("the escalation is delivered with a fresh question id", async () => {
	const { runtime, delivered } = makeRuntime();
	const result = await runtime.escalate(context());
	assert.equal(result.reused, false);
	assert.equal(result.deliveredAtLeastOne, true);
	assert.equal(result.state.questionId, "escalation-1");
	assert.notEqual(result.state.questionId, "q-179494");
	assert.equal(delivered.length, 1);
	assert.equal(delivered[0].questionId, "escalation-1");
});

test("the escalation is asked once per refused proposal", async () => {
	const { runtime, delivered } = makeRuntime();
	await runtime.escalate(context());
	const second = await runtime.escalate(context());
	assert.equal(second.reused, true);
	assert.equal(delivered.length, 1);
});

test("a delivery that fails leaves the work blocked", async () => {
	const { runtime, delivered } = makeRuntime([
		{ success: false, channel: "telegram", error: "no chat" },
		{ success: false, channel: "line", error: "no channel" },
	]);
	const result = await runtime.escalate(context());
	assert.equal(result.deliveredAtLeastOne, false);
	assert.equal(result.state.status, "blocked");
	assert.equal(result.state.delivered.length, 0);
	assert.equal(result.state.failures.length, 2);
	// The delivery is retried a bounded number of times.
	assert.equal(delivered.length, 3);
});

test("the retry asks the human once", async () => {
	const { runtime, delivered } = makeRuntime([
		{ success: false, channel: "telegram", error: "no chat" },
	]);
	const result = await runtime.escalate(context());
	assert.equal(result.state.status, "blocked");
	// Every attempt used the same question: the human is never asked
	// twice, and the buttons of an earlier attempt stay valid.
	const questionIds = new Set(delivered.map((entry) => entry.questionId));
	assert.equal(questionIds.size, 1);
	assert.equal([...questionIds][0], result.state.questionId);
});

test("a delivery that succeeds on a later attempt stops the retry", async () => {
	const { runtime, delivered } = makeRuntime((attempt) =>
		attempt === 1
			? [{ success: false, channel: "telegram", error: "no chat" }]
			: [{ success: true, channel: "telegram" }],
	);
	const result = await runtime.escalate(context());
	assert.equal(result.deliveredAtLeastOne, true);
	assert.equal(result.state.status, "open");
	assert.equal(delivered.length, 2);
});

test("the answer of the human is applied once", async () => {
	const { runtime, approved, rejected } = makeRuntime();
	const result = await runtime.escalate(context());
	assert.equal(runtime.answer(result.state.questionId, "yes"), true);
	assert.equal(approved.length, 1);
	assert.equal(rejected.length, 0);
	// A second click, and a click of another channel, do nothing.
	assert.equal(runtime.answer(result.state.questionId, "no"), false);
	assert.equal(approved.length, 1);
	assert.equal(rejected.length, 0);
});

test("a human rejection leaves the action blocked", async () => {
	const { runtime, approved, rejected } = makeRuntime();
	const result = await runtime.escalate(context());
	assert.equal(runtime.answer(result.state.questionId, "no"), true);
	assert.equal(rejected.length, 1);
	assert.equal(approved.length, 0);
});

test("the escalation is found by its question id", async () => {
	const { runtime } = makeRuntime();
	const result = await runtime.escalate(context());
	const found = runtime.forQuestion(result.state.questionId);
	assert.ok(found);
	assert.equal(found.context.originalRequestId, "q-179494");
	assert.equal(runtime.forQuestion("q-179494"), undefined);
});
