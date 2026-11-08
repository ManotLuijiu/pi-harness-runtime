/**
 * What the judge does with the result of an evaluation.
 *
 * Three things are locked down here:
 *
 * - a provider failure is an error, not a decision: it must never be
 *   recorded as "Jev decided to wait",
 * - the risk of the option that was selected decides, not only the risk of
 *   the question: an alternative can ask for something the question did not
 *   mention,
 * - the wait is measured from the moment the question was asked.
 */

import { describe, it, expect } from "bun:test";
import {
	AutoContinueJudge,
	createTaskState,
	type DecisionContext,
	type TaskState,
} from "../src/auto-continue.js";
import type { JevJudge } from "../src/index.js";

/** A judge that returns a fixed result. */
function fakeJudge(result: unknown): JevJudge {
	return {
		evaluate: async () => result,
	} as unknown as JevJudge;
}

/** A judge that fails the way a provider fails. */
function failingJudge(message: string): JevJudge {
	return {
		evaluate: async () => {
			throw new Error(message);
		},
	} as unknown as JevJudge;
}

/** The result of an evaluation that picks the first alternative. */
function pickingResult(selected: string) {
	return {
		decisions: {
			shouldProceed: { probability: 0.95 },
			riskLevel: { response: { score: 1 } },
			urgency: { response: { choice: "normal" } },
			estimatedImpact: { response: { choice: "minimal" } },
			waitBenefit: { response: { noul: 0.5 } },
			outcome: { response: { choice: "approve" } },
			selectedOption: { response: { choice: selected } },
		},
	};
}

/** The task state of a choice question. */
function choiceState(alternatives: string[]): TaskState {
	const context: DecisionContext = {
		question: {
			requestId: "q-1",
			text: "Which option do I take?",
			kind: "choice",
			askType: "choice",
			alternatives,
			// The risk facts of the question itself. Without them the
			// deterministic policy waits: the risk of the action is
			// unknown.
			requiresExplicitAuthorization: false,
			destructive: false,
			external: false,
			reversible: true,
		},
		totalTasks: 1,
		completedTasks: 0,
		waitedMinutes: 5,
	};
	return createTaskState([], ["do the work"], new Date(), new Date(), context);
}

describe("the result of an evaluation", () => {
	it("marks a provider failure as an error and not as a decision", async () => {
		const judge = new AutoContinueJudge(
			{ providers: [] },
			failingJudge("the provider is unreachable"),
		);

		const decision = await judge.decide(choiceState(["option_1", "option_2"]));

		// The outcome is only the fallback of the failure. The error says
		// that nothing was decided.
		expect(decision.evaluationError).toBeDefined();
		expect(decision.evaluationError?.kind).toBe("provider");
		expect(decision.evaluationError?.message).toContain("unreachable");
	});

	it("decides without an error when the evaluation worked", async () => {
		const judge = new AutoContinueJudge(
			{ providers: [] },
			fakeJudge(pickingResult("option_1")),
		);

		const decision = await judge.decide(choiceState(["option_1", "option_2"]));

		expect(decision.evaluationError).toBeUndefined();
		expect(decision.outcome).toBe("approve");
		expect(decision.selectedOption).toBe("option_1");
	});

	it("does not decide an option that needs an explicit authorization", async () => {
		const judge = new AutoContinueJudge(
			{ providers: [] },
			fakeJudge(pickingResult("option_1")),
		);

		// The question itself is harmless. The selected option is not: it
		// proposes to destroy something.
		const decision = await judge.decide(
			choiceState(["delete the production database", "keep the database"]),
		);

		expect(decision.selectedOption).toBe("delete the production database");
		expect(decision.outcome).toBe("wait");
		expect(decision.policyApplied).toBe("selected-option-requires-authorization");
	});

	it("decides an option that is harmless", async () => {
		const judge = new AutoContinueJudge(
			{ providers: [] },
			fakeJudge(pickingResult("option_1")),
		);

		const decision = await judge.decide(
			choiceState(["run the migration on the staging copy", "keep the state"]),
		);

		expect(decision.outcome).toBe("approve");
		expect(decision.policyApplied).not.toBe("selected-option-requires-authorization");
	});
});

describe("the wait of a task state", () => {
	it("is measured from the moment the question was asked", () => {
		const asked = new Date("2026-11-07T10:00:00Z");
		const state = createTaskState(
			[],
			["do the work"],
			// The user was active long before the question: that is a
			// different fact.
			new Date("2026-11-07T09:30:00Z"),
			new Date("2026-11-07T09:00:00Z"),
			undefined,
			{
				questionAskedAt: asked,
				now: () => new Date("2026-11-07T10:05:00Z").getTime(),
			},
		);

		expect(state.waitTimeMinutes).toBe(5);
		expect(state.questionAskedAt).toEqual(asked);
	});
});
