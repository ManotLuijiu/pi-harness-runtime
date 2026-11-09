import { test } from "node:test";
import assert from "node:assert/strict";

import { PendingQuestionController } from "../packages/notification/dist/pending-question.js";
import { WaitLifecycleController } from "../packages/jev-judge/dist/wait-lifecycle.js";
import { PendingQuestionCountdown } from "../harness/pending-countdown.ts";
import { createPendingActionRegistry } from "../harness/pending-actions.ts";
import {
	clearObsoleteWait,
	isObsoleteQuestion,
	jevWaitEligibility,
	jevWaitRegistration,
	questionRelevance,
	workStateFromTodos,
} from "../harness/jev-wait-eligibility.ts";

const MINUTE = 60_000;

/**
 * A clock that the test drives.
 */
function createClock() {
	let now = 1_000_000;
	const timers = new Map();
	let seq = 0;
	return {
		now: () => now,
		advance(ms) {
			now += ms;
			for (const [handle, timer] of [...timers.entries()]) {
				if (timer.at <= now) {
					timers.delete(handle);
					timer.callback();
				}
			}
		},
		setTimeout(callback, ms) {
			seq += 1;
			timers.set(seq, { callback, at: now + ms });
			return seq;
		},
		clearTimeout(handle) {
			timers.delete(handle);
		},
	};
}

/**
 * The harness of a wait: the question controller, the lifecycle, the
 * countdown and the registry of the pending actions, wired the way the
 * runtime wires them.
 */
function createHarness(options = {}) {
	const clock = createClock();
	const actions = createPendingActionRegistry();
	const questions = new PendingQuestionController({
		evaluationDelayMs: 5 * MINUTE,
	});
	const evaluations = [];
	const rows = [];

	const countdown = new PendingQuestionCountdown({
		waitMinutes: 5,
		now: clock.now,
		setInterval: (callback, ms) => clock.setTimeout(callback, ms),
		clearInterval: (handle) => clock.clearTimeout(handle),
		render: (view) => rows.push(view),
		onDeadline: (requestId) => {
			deadlines.push(requestId);
		},
		isPending: () => true,
		onStop: (requestId) => {
			if (requestId) actions.remove(`jev-decision:${requestId}`);
		},
	});

	const deadlines = [];

	const lifecycle = new WaitLifecycleController({
		waitMinutes: 5,
		now: clock.now,
		countdown: {
			get active() {
				return countdown.active;
			},
			start: (requestId, startedAt) => countdown.start(requestId, startedAt),
			stop: () => countdown.stop(),
		},
		currentSessionId: () => "session-1",
		evaluate: async (request) => {
			evaluations.push(request.requestId);
			return { outcome: "continue", reasoning: "the judge decided" };
		},
		eligibility: options.eligibility ?? (() => ({ eligible: true, reason: "ok" })),
	});

	return { clock, actions, questions, lifecycle, countdown, evaluations, deadlines, rows };
}

/**
 * The row of the judge in the registry.
 */
const jevRowId = (requestId) => `jev-decision:${requestId}`;

test("an offer after the completion starts no countdown and no question", () => {
	const work = workStateFromTodos([{ status: "completed" }]);
	assert.equal(work, "complete");

	const relevance = questionRelevance({
		text: "Would you like me to add another feature?",
		work,
	});
	assert.equal(relevance, "optional-offer");

	const eligibility = jevWaitEligibility({ relevance, work });
	assert.equal(eligibility.eligible, false);

	// The harness does not create the question, so nothing waits, nothing
	// counts down and the completion of the request is not blocked.
	const harness = createHarness();
	assert.equal(harness.questions.hasPendingQuestion(), false);
	assert.equal(harness.lifecycle.currentState, "idle");
	assert.equal(harness.actions.list().length, 0);
});

test("a question about the requested scope is registered", () => {
	// The wording of the question is phrased like an offer. The scope of
	// the request decides: the question names the work that was asked for.
	const scope = ["Implement A"];
	const relevance = questionRelevance({
		text: "Want me to implement A, or A+B?",
		work: "unfinished",
		scope,
	});
	assert.equal(relevance, "current-request");

	const harness = createHarness();
	const question = harness.questions.createQuestion({
		text: "Want me to implement A, or A+B?",
		sessionId: "s-1",
		workspacePath: "/tmp",
		kind: "approval",
		relevance,
	});
	assert.ok(question, "the question is registered");
	assert.equal(harness.questions.hasPendingQuestion(), true);
});

test("a necessary clarification is registered and protects the continuation", () => {
	// Todo: "Configure authentication." Question: "Which identity provider
	// should I use?" The question names nothing of the request, but the
	// agent cannot continue without the answer, so it is registered and it
	// holds the continuation.
	const relevance = questionRelevance({
		text: "Which identity provider should I use?",
		work: "unfinished",
		scope: ["Configure authentication"],
		action: "Which identity provider should I use?",
		kind: "clarification",
	});
	assert.equal(relevance, "current-request");

	const harness = createHarness();
	const question = harness.questions.createQuestion({
		text: "Which identity provider should I use?",
		sessionId: "s-1",
		workspacePath: "/tmp",
		kind: "clarification",
		relevance,
	});
	assert.ok(question, "the clarification is registered");
	assert.equal(
		harness.questions.hasPendingQuestion(),
		true,
		"the question protects the continuation against an automatic decision",
	);
});

test("a question outside the requested scope stays open without a countdown", () => {
	// Keeping the question open and letting the judge answer it are two
	// decisions: the question waits for the human, and its silence decides
	// nothing.
	const scope = ["Implement A"];
	const relevance = questionRelevance({
		text: "May I add an export feature?",
		work: "unfinished",
		scope,
	});
	assert.equal(relevance, "optional-offer");
	assert.equal(jevWaitEligibility({ relevance, work: "unfinished" }).eligible, false);
	assert.equal(jevWaitRegistration({ relevance, work: "unfinished" }).register, true);

	const harness = createHarness();
	const question = harness.questions.createQuestion({
		text: "May I add an export feature?",
		sessionId: "s-1",
		workspacePath: "/tmp",
		kind: "approval",
		relevance,
	});
	assert.ok(question, "the question is registered");
	assert.equal(
		harness.questions.hasPendingQuestion(),
		true,
		"the question holds the continuation against an automatic decision",
	);
	assert.equal(
		harness.lifecycle.currentState,
		"idle",
		"no countdown runs for a question that may not be answered by silence",
	);
});

test("an offer in the form of a question after the completion starts no countdown", () => {
	// The wording list does not have to know every offer: the request is
	// done, so a question that follows it waits for an explicit request.
	const work = workStateFromTodos([{ status: "completed" }]);
	assert.equal(work, "complete");

	const relevance = questionRelevance({
		text: "May I add an export feature?",
		work,
	});
	assert.equal(relevance, "final-request");
	assert.equal(jevWaitEligibility({ relevance, work }).eligible, false);

	// Nothing waits, nothing counts down, and the completion of the
	// request is not blocked.
	const harness = createHarness();
	assert.equal(harness.questions.hasPendingQuestion(), false);
	assert.equal(harness.lifecycle.currentState, "idle");
	assert.equal(harness.actions.list().length, 0);
});

test("a pending validation keeps the question of the request", () => {
	// The todos are marked complete, but the required final tier has not
	// passed: the request is not finished, so a question about it is not
	// obsolete.
	const items = [{ status: "completed" }];
	const work = workStateFromTodos(items, { validationPending: true });
	assert.equal(work, "unfinished");

	const relevance = questionRelevance({ text: "May I apply the migration?", work });
	assert.equal(relevance, "current-request");
	assert.equal(jevWaitEligibility({ relevance, work }).eligible, true);
	assert.equal(isObsoleteQuestion({ relevance, work }).obsolete, false);
});

test("a question that becomes obsolete is cleared with its row", () => {
	const harness = createHarness();
	const question = harness.questions.createQuestion({
		text: "May I apply the migration?",
		sessionId: "session-1",
		workspacePath: "/tmp",
		kind: "approval",
		relevance: "current-request",
	});
	harness.lifecycle.begin({
		requestId: question.requestId,
		sessionId: "session-1",
		text: question.questionText,
		relevance: "current-request",
	});
	harness.actions.register({
		id: jevRowId(question.requestId),
		sessionId: "session-1",
		owner: "jev-decision",
		kind: "jev-decision",
		state: "scheduled",
		dueAt: harness.clock.now() + 5 * MINUTE,
		reason: "the decision of the judge",
	});

	assert.equal(harness.questions.hasPendingQuestion(), true);
	assert.equal(harness.actions.get(jevRowId(question.requestId)) !== null, true);
	assert.equal(harness.lifecycle.currentState, "waiting");

	// The work of the request is done: the question is obsolete.
	const obsolete = isObsoleteQuestion({
		relevance: "current-request",
		work: "complete",
	});
	assert.equal(obsolete.obsolete, true);

	clearObsoleteWait({
		requestId: question.requestId,
		cancelQuestion: (reason) => harness.questions.cancel(reason),
		cancelWait: () => harness.lifecycle.cancel(),
		removeRow: (requestId) => harness.actions.remove(jevRowId(requestId)),
	});

	assert.equal(harness.questions.hasPendingQuestion(), false);
	assert.equal(harness.lifecycle.currentState, "idle");
	assert.equal(harness.actions.get(jevRowId(question.requestId)), null);
	assert.equal(harness.countdown.active, false);
});

test("an evaluation that arrives after the completion is inert", () => {
	let eligible = true;
	const harness = createHarness({
		eligibility: () => ({
			eligible,
			reason: eligible ? "ok" : "the work of the question is done",
		}),
	});
	const question = harness.questions.createQuestion({
		text: "May I apply the migration?",
		sessionId: "session-1",
		workspacePath: "/tmp",
		kind: "approval",
		relevance: "current-request",
	});
	harness.lifecycle.begin({
		requestId: question.requestId,
		sessionId: "session-1",
		text: question.questionText,
		relevance: "current-request",
	});

	// The work is done while the wait runs.
	harness.clock.advance(5 * MINUTE);
	eligible = false;

	return harness.lifecycle.evaluateDue().then((result) => {
		assert.equal(result.applied, false);
		assert.equal(result.discardReason, "not-eligible");
		assert.equal(harness.evaluations.length, 0, "the judge is never asked");
		assert.equal(harness.lifecycle.currentState, "idle");
	});
});

test("zero todos with a genuine question preserve the question", () => {
	// An empty task list is no evidence that the request is finished.
	const work = workStateFromTodos([]);
	assert.equal(work, "unknown");

	const relevance = questionRelevance({ text: "May I deploy?", work });
	assert.equal(relevance, "current-request");

	const eligibility = jevWaitEligibility({ relevance, work });
	assert.equal(eligibility.eligible, true);

	const harness = createHarness();
	const question = harness.questions.createQuestion({
		text: "May I deploy?",
		sessionId: "session-1",
		workspacePath: "/tmp",
		kind: "approval",
		relevance,
	});
	harness.lifecycle.begin({
		requestId: question.requestId,
		sessionId: "session-1",
		text: question.questionText,
		relevance,
	});

	assert.equal(harness.questions.hasPendingQuestion(), true);
	assert.equal(harness.lifecycle.currentState, "waiting");
	assert.equal(
		isObsoleteQuestion({ relevance, work }).obsolete,
		false,
		"an unknown state of the work never makes a question obsolete",
	);
});

test("an unreadable task list is not an empty list", () => {
	// The provider cannot be read: the state of the work is unknown, not
	// finished.
	const work = workStateFromTodos([{ status: "completed" }], { available: false });
	assert.equal(work, "unknown");
	assert.equal(
		jevWaitEligibility({ relevance: "current-request", work }).eligible,
		true,
	);
});

test("an obsolete Jev wait does not clear the countdown of another owner", () => {
	const harness = createHarness();
	const question = harness.questions.createQuestion({
		text: "May I apply the migration?",
		sessionId: "session-1",
		workspacePath: "/tmp",
		kind: "approval",
		relevance: "current-request",
	});
	harness.actions.register({
		id: jevRowId(question.requestId),
		sessionId: "session-1",
		owner: "jev-decision",
		kind: "jev-decision",
		state: "scheduled",
		dueAt: harness.clock.now() + 5 * MINUTE,
		reason: "the decision of the judge",
	});
	harness.actions.register({
		id: "provider-recovery",
		sessionId: "session-1",
		owner: "provider",
		kind: "retry",
		state: "scheduled",
		dueAt: harness.clock.now() + MINUTE,
		reason: "the provider failed",
	});

	clearObsoleteWait({
		requestId: question.requestId,
		cancelQuestion: (reason) => harness.questions.cancel(reason),
		cancelWait: () => harness.lifecycle.cancel(),
		removeRow: (requestId) => harness.actions.remove(jevRowId(requestId)),
	});

	assert.equal(harness.actions.get(jevRowId(question.requestId)), null);
	const provider = harness.actions.get("provider-recovery");
	assert.ok(provider, "the countdown of the provider recovery survives");
	assert.equal(provider.dueAt, harness.clock.now() + MINUTE);
});
