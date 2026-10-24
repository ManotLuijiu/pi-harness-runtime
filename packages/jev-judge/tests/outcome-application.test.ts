/**
 * The structured outcome of the evaluation.
 *
 * Jev has to be able to reject a proposed action, and the outcome of the
 * evaluation may only tighten the decision the thresholds allow.
 */

import { describe, it, expect } from "bun:test";
import {
	applyDecisionPolicy,
	isDecisionOutcome,
	tightenOutcome,
	type DecisionContext,
} from "../src/auto-continue.js";

const context: DecisionContext = {
	question: {
		requestId: "q-1",
		text: "Should I continue with the remaining tasks?",
		kind: "routine",
		requiresExplicitAuthorization: false,
		destructive: false,
		external: false,
		reversible: true,
	},
	currentTask: "Build the toggle",
	completionRatio: 0.5,
	totalTasks: 4,
	completedTasks: 2,
	blockers: [],
	nextTasks: ["Build the toggle"],
	validationStatus: "no pending final tier",
	waitedMinutes: 6,
	deadlineMinutes: 30,
};

describe("the structured outcome of the evaluation", () => {
	it("recognizes the known outcomes", () => {
		expect(isDecisionOutcome("approve")).toBe(true);
		expect(isDecisionOutcome("proceed_with_caution")).toBe(true);
		expect(isDecisionOutcome("wait")).toBe(true);
		expect(isDecisionOutcome("reject")).toBe(true);
	});

	it("ignores an unknown outcome", () => {
		expect(isDecisionOutcome("maybe")).toBe(false);
		expect(isDecisionOutcome(undefined)).toBe(false);
	});
});

describe("tightenOutcome", () => {
	it("keeps a rejection a rejection", () => {
		expect(tightenOutcome("approve", "reject")).toBe("reject");
		expect(tightenOutcome("wait", "reject")).toBe("reject");
	});

	it("keeps a wait a wait", () => {
		expect(tightenOutcome("approve", "wait")).toBe("wait");
	});

	it("turns an approval into a cautious approval", () => {
		expect(tightenOutcome("approve", "proceed_with_caution")).toBe(
			"proceed_with_caution",
		);
	});

	it("never lets an approval beat the thresholds", () => {
		expect(tightenOutcome("wait", "approve")).toBe("wait");
		expect(tightenOutcome("proceed_with_caution", "approve")).toBe(
			"proceed_with_caution",
		);
	});

	it("keeps the threshold outcome without a proposal", () => {
		expect(tightenOutcome("approve", undefined)).toBe("approve");
	});
});

describe("the policy of a rejection", () => {
	it("keeps a rejection", () => {
		const result = applyDecisionPolicy("reject", context);

		expect(result.outcome).toBe("reject");
		expect(result.appliedRule).toBeUndefined();
	});

	it("never turns a rejection into an approval", () => {
		const result = applyDecisionPolicy("reject", context, {
			confidence: 0.99,
		});

		expect(result.outcome).toBe("reject");
	});
});

describe("the policy of unknown risk facts", () => {
	it("waits when nothing is known about the action", () => {
		const result = applyDecisionPolicy(
			"approve",
			{
				...context,
				question: {
					requestId: "q-1",
					text: "Should I continue?",
					kind: "routine",
				},
			},
			{ confidence: 0.99 },
		);

		expect(result.outcome).toBe("wait");
		expect(result.appliedRule).toBe("unknown-risk-facts");
	});

	it("still blocks a clarification first", () => {
		const result = applyDecisionPolicy(
			"approve",
			{
				...context,
				question: {
					requestId: "q-1",
					text: "Do you mean the toggle or the switch?",
					kind: "clarification",
				},
			},
			{ confidence: 0.99 },
		);

		expect(result.outcome).toBe("wait");
		expect(result.appliedRule).toBe("clarification-never-approved");
	});
});
