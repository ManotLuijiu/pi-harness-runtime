/**
 * The runtime rules of an open question.
 *
 * The defects this suite locks down:
 *
 *  - the work continued behind a question that nobody had answered: the
 *    wait was over (Jev asked a human, or the evaluation failed), the
 *    question was still open, and a later `agent_settled` dispatched todo
 *    work anyway,
 *  - a reply of the user in Pi did not close a question of a terminal
 *    state: the buttons of the old notification stayed actionable and a
 *    later click injected a second answer.
 *
 * The rules live in `harness/pending-question-state.ts`; the runtime uses
 * them in `index.ts` (the user message handler and the `agent_settled`
 * handler).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	isQuestionOpen,
	isRejection,
	mayContinue,
	userReplyEffect,
} from "../harness/pending-question-state.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/**
 * The runtime around the rules.
 *
 * The two handlers of the runtime that use the rules are modelled here:
 * the handler of a user message and the handler of an `agent_settled`
 * event. The wiring itself is checked against the source of the runtime
 * below, so the model cannot drift away from it silently.
 */
function createRuntime(question) {
	const state = {
		question: question ?? null,
		waiting: false,
		paused: false,
		dispatched: false,
		cancelled: [],
		status: "WAITING",
	};

	const continuation = {
		explicitPause() {
			state.paused = true;
		},
		resume() {
			state.paused = false;
		},
		clearQueue() {
			state.queueCleared = true;
		},
	};

	return {
		state,
		/** The handler of a user message of the runtime. */
		userMessage(text = "") {
			const effect = userReplyEffect({
				waiting: state.waiting,
				questionOpen: isQuestionOpen(state.question),
			});
			if (effect === "none") return effect;
			state.waiting = false;
			state.status = "IDLE";
			if (state.question) {
				state.cancelled.push(state.question.requestId);
				state.question.state = "cancelled";
				state.question = null;
			}
			// A decline of the proposal pauses the work: the work must not
			// continue behind a decline.
			if (isRejection(text)) {
				continuation.explicitPause();
			}
			// Closing the question is not an authorization: the work that
			// waits for an answer stays paused.
			return effect;
		},
		/** The handler of an `agent_settled` event of the runtime. */
		agentSettled() {
			// A paused continuation dispatches nothing: the pause is what
			// the controller checks before it sends a steer.
			if (state.paused) {
				continuation.clearQueue();
				return false;
			}
			if (
				!mayContinue({
					waiting: state.waiting,
					questionOpen: isQuestionOpen(state.question),
				})
			) {
				continuation.clearQueue();
				return false;
			}
			state.dispatched = true;
			return true;
		},
		/** The handler of a failed evaluation of the runtime. */
		evaluationError() {
			state.paused = true;
		},
		continuation,
	};
}

test("a question that waits for an answer is open", () => {
	assert.equal(isQuestionOpen({ state: "pending" }), true);
	assert.equal(isQuestionOpen({ state: "evaluating" }), true);
});

test("a closed question is not open", () => {
	assert.equal(isQuestionOpen({ state: "resolved" }), false);
	assert.equal(isQuestionOpen({ state: "cancelled" }), false);
	assert.equal(isQuestionOpen({ state: "expired" }), false);
	assert.equal(isQuestionOpen(null), false);
	assert.equal(isQuestionOpen(undefined), false);
});

test("the work does not continue behind an open question", () => {
	// The wait is over - Jev asked a human, or the evaluation failed - and
	// the question is still open: the answer is still missing.
	assert.equal(
		mayContinue({ waiting: false, questionOpen: true }),
		false,
		"an open question blocks the work",
	);
});

test("the work does not continue while the wait runs", () => {
	assert.equal(mayContinue({ waiting: true, questionOpen: true }), false);
	assert.equal(mayContinue({ waiting: true, questionOpen: false }), false);
});

test("the work continues when nothing waits for an answer", () => {
	assert.equal(mayContinue({ waiting: false, questionOpen: false }), true);
});

test("a reply in a terminal state closes the open question", () => {
	// Jev asked a human: the wait is over, the question is not. The reply
	// of the user answers it.
	const effect = userReplyEffect({ waiting: false, questionOpen: true });

	assert.equal(effect, "cancelled-question");
});

test("a reply while the wait runs closes the wait and the question", () => {
	const effect = userReplyEffect({ waiting: true, questionOpen: true });

	assert.equal(effect, "cancelled-wait-and-question");
});

test("a reply without an open question changes nothing", () => {
	assert.equal(userReplyEffect({ waiting: false, questionOpen: false }), "none");
});

test("the runtime does not dispatch work behind an open question", () => {
	// The evaluation failed: the wait is over, the question is open.
	const runtime = createRuntime({ requestId: "q-1", state: "pending" });
	runtime.state.waiting = false;

	assert.equal(runtime.agentSettled(), false, "no work is dispatched");
	assert.equal(runtime.state.dispatched, false);
});

test("the runtime pauses the work when the evaluation failed", () => {
	const runtime = createRuntime({ requestId: "q-1", state: "pending" });

	runtime.evaluationError();

	assert.equal(runtime.state.paused, true, "the work waits for the answer");
});

test("the runtime closes the question on a reply in a terminal state", () => {
	const runtime = createRuntime({ requestId: "q-1", state: "pending" });
	runtime.state.waiting = false;
	runtime.evaluationError();

	const effect = runtime.userMessage();

	assert.equal(effect, "cancelled-question");
	assert.deepEqual(runtime.state.cancelled, ["q-1"], "the question is closed");
	assert.equal(
		isQuestionOpen(runtime.state.question),
		false,
		"the buttons of the question cannot inject a second answer",
	);
	assert.equal(
		runtime.state.paused,
		true,
		"closing the question is not an authorization: the work stays paused",
	);
});

test("a declining reply retains the pause", () => {
	const runtime = createRuntime({ requestId: "q-1", state: "pending" });
	runtime.state.waiting = false;
	runtime.evaluationError();

	// "No, do not implement it" is an answer, not a resume directive.
	runtime.userMessage("No, do not implement it");

	assert.equal(runtime.state.paused, true, "the work does not continue");
	assert.equal(
		runtime.agentSettled(),
		false,
		"the next settled turn does not dispatch work behind the pause",
	);
	assert.equal(runtime.state.dispatched, false);
});

test("a rejection during the countdown pauses the work", () => {
	// The wait runs, the question is open, and the work is not paused yet:
	// the countdown is the deadline of the decision, not a pause.
	const runtime = createRuntime({ requestId: "q-1", state: "pending" });
	runtime.state.waiting = true;

	assert.equal(runtime.state.paused, false, "the countdown pauses nothing yet");

	const effect = runtime.userMessage("No, do not implement it");

	assert.equal(effect, "cancelled-wait-and-question", "the question is closed");
	assert.deepEqual(runtime.state.cancelled, ["q-1"]);
	assert.equal(runtime.state.waiting, false, "the wait is over");
	assert.equal(
		runtime.state.paused,
		true,
		"a rejection pauses the work, also during the countdown",
	);
	assert.equal(
		runtime.agentSettled(),
		false,
		"the next settled turn does not dispatch work behind the decline",
	);
	assert.equal(runtime.state.dispatched, false);
});

test("a reply that declines is a rejection", () => {
	assert.equal(isRejection("No, do not implement it"), true);
	assert.equal(isRejection("No"), true);
	assert.equal(isRejection("No."), true);
	assert.equal(isRejection("Nope"), true);
	assert.equal(isRejection("Never mind"), true);
	assert.equal(isRejection("Cancel that"), true);
	assert.equal(isRejection("Don't do it"), true);
	assert.equal(isRejection("Do not implement it"), true);
	assert.equal(isRejection("I do not want that"), true);
});

test("a reply that does not decline is not a rejection", () => {
	assert.equal(isRejection("Yes, go ahead"), false);
	assert.equal(isRejection("resume"), false);
	assert.equal(isRejection("No changes are needed, everything works"), false);
	assert.equal(isRejection("There is no error in the log"), false);
	assert.equal(isRejection(""), false);
	assert.equal(isRejection(undefined), false);
});

test("the runtime closes the question on a reply while the wait runs", () => {
	const runtime = createRuntime({ requestId: "q-1", state: "pending" });
	runtime.state.waiting = true;

	const effect = runtime.userMessage();

	assert.equal(effect, "cancelled-wait-and-question");
	assert.deepEqual(runtime.state.cancelled, ["q-1"]);
	assert.equal(runtime.state.waiting, false, "the wait is over");
});

test("the runtime dispatches the work when no question is open", () => {
	const runtime = createRuntime(null);

	assert.equal(runtime.agentSettled(), true);
	assert.equal(runtime.state.dispatched, true);
});

test("the runtime uses the rules in its handlers", () => {
	assert.match(
		indexSource,
		/userMessage[\s\S]*userReplyEffect\(/,
		"the handler of a user message uses the rule of the reply",
	);
	assert.match(
		indexSource,
		/agent_settled[\s\S]*?mayContinue\(/,
		"the handler of an agent_settled event uses the rule of the continuation",
	);
	assert.match(
		indexSource,
		/evaluation_error[\s\S]*?explicitPause\?\.\(\)/,
		"a failed evaluation pauses the work",
	);
	assert.ok(
		!/const replyEffect[\s\S]*?resume\?\.\(\)/.test(indexSource),
		"closing the question never resumes the work on its own",
	);
	assert.match(
		indexSource,
		/isRejection\(content\)[\s\S]*?explicitPause\?\.\(\)/,
		"a rejection of the proposal pauses the work",
	);
	assert.match(
		indexSource,
		/detectExplicitPause[\s\S]*?isRejection\(text\)/,
		"a rejection is a pause directive for the later handler as well",
	);
});
