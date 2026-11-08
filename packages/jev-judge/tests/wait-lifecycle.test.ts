/**
 * The lifecycle of a wait for a human answer.
 *
 * The harness asks a human a question and waits. When the wait is over the
 * question is decided once. These tests use a fake clock and a fake
 * provider, so the behaviour is measured and not assumed:
 *
 * - at 4:59 nothing is evaluated,
 * - at 5:00 exactly one evaluation happens,
 * - a valid choice produces exactly one decision,
 * - a human reply and a replacement question invalidate the evaluation.
 */

import { describe, it, expect } from "bun:test";
import {
	WaitLifecycleController,
	type WaitEvaluation,
	type WaitRequest,
} from "../src/wait-lifecycle.js";

/** A clock the test drives. */
function createClock(start = 1_000_000) {
	let now = start;
	return {
		now: () => now,
		advance(ms: number) {
			now += ms;
		},
	};
}

/** A request the tests wait for. */
function request(overrides: Partial<WaitRequest> = {}): WaitRequest {
	return {
		requestId: "q-1",
		sessionId: "s-1",
		kind: "choice",
		askType: "choice",
		text: "Which option do I take?",
		alternatives: ["option_1", "option_2"],
		...overrides,
	};
}

/** A provider the test drives. */
function createProvider() {
	const calls: Array<{ request: WaitRequest; waitedMs: number }> = [];
	let answer: WaitEvaluation = {
		outcome: "approve",
		selectedOption: "option_1",
		reasoning: "the work is reversible",
	};
	let pending: {
		resolve: (evaluation: WaitEvaluation) => void;
		reject: (error: unknown) => void;
	} | null = null;
	return {
		calls,
		setAnswer(next: WaitEvaluation) {
			answer = next;
		},
		/** The provider holds the answer until the test releases it. */
		hold() {
			return new Promise<WaitEvaluation>((resolve, reject) => {
				pending = { resolve, reject };
			});
		},
		release(evaluation?: WaitEvaluation) {
			pending?.resolve(evaluation ?? answer);
			pending = null;
		},
		fail(error: unknown) {
			pending?.reject(error);
			pending = null;
		},
		async evaluate(call: WaitRequest, waitedMs: number): Promise<WaitEvaluation> {
			calls.push({ request: call, waitedMs });
			if (pending) return this.hold();
			return answer;
		},
	};
}

describe("the wait for a human answer", () => {
	it("evaluates nothing before the deadline and exactly once at it", async () => {
		const clock = createClock();
		const provider = createProvider();
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
		});

		controller.begin(request());
		expect(controller.currentState).toBe("waiting");

		// 4:59 - the question has not waited long enough.
		clock.advance(4 * 60_000 + 59_000);
		const early = await controller.evaluateDue();
		expect(early.applied).toBe(false);
		expect(early.discardReason).toBe("not-due");
		expect(provider.calls).toHaveLength(0);

		// 5:00 - the deadline is reached and the question is decided once.
		clock.advance(1000);
		const due = await controller.evaluateDue();
		expect(due.applied).toBe(true);
		expect(due.state).toBe("decided");
		expect(provider.calls).toHaveLength(1);

		// A second attempt changes nothing: the question was decided.
		const again = await controller.evaluateDue();
		expect(again.applied).toBe(false);
		expect(again.discardReason).toBe("not-waiting");
		expect(provider.calls).toHaveLength(1);
	});

	it("gives Jev one elapsed time, measured from the question", async () => {
		const clock = createClock();
		const provider = createProvider();
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
		});

		controller.begin(request());
		// The session was busy before the question: the wait is the time
		// since the question, not the time since the last activity.
		clock.advance(5 * 60_000);
		await controller.evaluateDue();

		expect(provider.calls).toHaveLength(1);
		expect(provider.calls[0].waitedMs).toBe(5 * 60_000);
		expect(controller.waitedMinutes()).toBeCloseTo(5, 5);
	});

	it("delivers the decision of a valid choice exactly once", async () => {
		const clock = createClock();
		const provider = createProvider();
		const states: string[] = [];
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
			onState: (state) => states.push(state),
		});

		controller.begin(request());
		clock.advance(5 * 60_000);
		const result = await controller.evaluateDue();

		expect(result.applied).toBe(true);
		expect(result.state).toBe("decided");
		expect(result.evaluation?.outcome).toBe("approve");
		expect(result.evaluation?.selectedOption).toBe("option_1");
		// The decision is delivered once: the states are the ones of the
		// lifecycle, and "decided" appears exactly once.
		expect(states.filter((state) => state === "decided")).toHaveLength(1);
	});

	it("discards the evaluation of a question that a human answered", async () => {
		const clock = createClock();
		const provider = createProvider();
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
		});

		controller.begin(request());
		clock.advance(5 * 60_000);
		const running = controller.evaluateDue();

		// The human answers while Jev is still evaluating.
		controller.answer("q-1");
		provider.release({
			outcome: "approve",
			selectedOption: "option_1",
			reasoning: "the work is reversible",
		});

		const result = await running;
		expect(result.applied).toBe(false);
		expect(result.discardReason).toBe("stale");
		expect(controller.currentState).toBe("idle");
	});

	it("discards the evaluation of a question that was replaced", async () => {
		const clock = createClock();
		const provider = createProvider();
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
		});

		controller.begin(request());
		clock.advance(5 * 60_000);
		const running = controller.evaluateDue();

		// A newer question replaces the old one.
		controller.begin(request({ requestId: "q-2", text: "Another question?" }));
		provider.release({
			outcome: "approve",
			reasoning: "the work is reversible",
		});

		const result = await running;
		expect(result.applied).toBe(false);
		expect(result.discardReason).toBe("stale");
		// The new question keeps its own wait.
		expect(controller.currentState).toBe("waiting");
		expect(controller.currentRequestId).toBe("q-2");
	});

	it("stamps the request and the session the decision was made for", async () => {
		const clock = createClock();
		const provider = createProvider();
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
		});

		controller.begin(request());
		clock.advance(5 * 60_000);
		const result = await controller.evaluateDue();

		// The decision names the question it belongs to. Without the
		// identity it could be applied to whatever question is current
		// when the result arrives.
		expect(result.evaluation?.requestId).toBe("q-1");
		expect(result.evaluation?.sessionId).toBe("s-1");
		expect(controller.ownsEvaluation(result.evaluation!)).toBe(true);
	});

	it("does not apply the decision of a replaced question to the question that waits", async () => {
		const clock = createClock();
		const provider = createProvider();
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
		});

		controller.begin(request());
		clock.advance(5 * 60_000);
		const running = controller.evaluateDue();

		// A newer question replaces the old one while the provider runs.
		controller.begin(request({ requestId: "q-2", text: "Another question?" }));
		provider.release({
			outcome: "approve",
			selectedOption: "option_1",
			reasoning: "the work is reversible",
		});

		const result = await running;
		expect(result.applied).toBe(false);
		expect(result.discardReason).toBe("stale");
		// The decision of the old question does not belong to the question
		// that waits now: it must not close, continue or clear it.
		expect(controller.currentRequestId).toBe("q-2");
		expect(
			controller.ownsEvaluation({
				outcome: "approve",
				reasoning: "",
				requestId: "q-1",
				sessionId: "s-1",
			}),
		).toBe(false);
		// The new question is decided on its own.
		clock.advance(5 * 60_000);
		const decided = await controller.evaluateDue();
		expect(decided.applied).toBe(true);
		expect(decided.evaluation?.requestId).toBe("q-2");
		expect(controller.ownsEvaluation(decided.evaluation!)).toBe(true);
	});

	it("discards the result of a session change during the evaluation", async () => {
		const clock = createClock();
		const provider = createProvider();
		let session = "s-1";
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			currentSessionId: () => session,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
		});

		controller.begin(request());
		clock.advance(5 * 60_000);
		const running = controller.evaluateDue();

		// The session changes while the provider is still working.
		session = "s-2";
		provider.release({
			outcome: "approve",
			reasoning: "the work is reversible",
		});

		const result = await running;
		expect(result.applied).toBe(false);
		expect(result.discardReason).toBe("other-session");
		expect(result.evaluation).toBeUndefined();
	});

	it("reports a provider failure as an error, not as a decision", async () => {
		const clock = createClock();
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			evaluate: async () => {
				throw new Error("the provider is unreachable");
			},
		});

		controller.begin(request());
		clock.advance(5 * 60_000);
		const result = await controller.evaluateDue();

		expect(result.applied).toBe(true);
		expect(result.state).toBe("evaluation_error");
		expect(result.evaluation?.error?.message).toContain("unreachable");
		// A failure is not a decision: the outcome does not say "wait".
		expect(result.evaluation?.outcome).not.toBe("approve");
	});

	it("does not evaluate a question of another session", async () => {
		const clock = createClock();
		const provider = createProvider();
		let session = "s-1";
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			currentSessionId: () => session,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
		});

		controller.begin(request());
		clock.advance(5 * 60_000);
		session = "s-2";

		const result = await controller.evaluateDue();
		expect(result.applied).toBe(false);
		expect(result.discardReason).toBe("other-session");
		expect(provider.calls).toHaveLength(0);
	});

	it("ends the automatic attempt when the decision asks for a human", async () => {
		const clock = createClock();
		const provider = createProvider();
		provider.setAnswer({
			outcome: "wait",
			reasoning: "the action needs a human",
		});
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			evaluate: (call, waitedMs) => provider.evaluate(call, waitedMs),
		});

		controller.begin(request());
		clock.advance(5 * 60_000);
		const result = await controller.evaluateDue();

		expect(result.state).toBe("human_required");
		// The wait does not arm another attempt: a second evaluation would
		// be a second evaluation of the same question.
		const again = await controller.evaluateDue();
		expect(again.applied).toBe(false);
		expect(provider.calls).toHaveLength(1);
	});

	it("starts the countdown with the moment the question was asked", () => {
		const clock = createClock();
		const starts: Array<{ requestId: string; startedAt: number }> = [];
		const controller = new WaitLifecycleController({
			now: clock.now,
			waitMinutes: 5,
			countdown: {
				active: false,
				start: (requestId, startedAt) => starts.push({ requestId, startedAt }),
				stop: () => undefined,
			},
			evaluate: async () => ({ outcome: "approve", reasoning: "" }),
		});

		controller.begin(request());
		expect(starts).toHaveLength(1);
		expect(starts[0].requestId).toBe("q-1");
		expect(starts[0].startedAt).toBe(clock.now());
	});
});
