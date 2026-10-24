/**
 * Decision context tests.
 *
 * Jev has to see the question it decides about, and the deterministic policy
 * has to decide what is actually allowed. A clarification is never an
 * approval, and an action that needs an explicit authorization or that
 * cannot be undone is never approved autonomously.
 */

import { describe, it, expect } from "bun:test";
import {
	applyDecisionPolicy,
	buildDecisionState,
	createTaskState,
	isEligibleForDecision,
	MAX_LISTED_TASKS,
	MAX_QUESTION_CHARS,
	type DecisionContext,
} from "../src/auto-continue.js";

function context(overrides: Partial<DecisionContext> = {}): DecisionContext {
	return {
		question: {
			requestId: "q-123",
			text: "Want me to implement the toggle buttons now?",
			kind: "approval",
			proposedAction: "implement the toggle buttons",
			consequence: "the button files change",
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
		nextTasks: ["Build the toggle", "Write the test"],
		validationStatus: "no pending final tier",
		waitedMinutes: 6,
		deadlineMinutes: 30,
		...overrides,
	};
}

describe("decision threshold", () => {
	it("is not eligible before the threshold", () => {
		expect(isEligibleForDecision(4.9, 5)).toBe(false);
		expect(isEligibleForDecision(5, 5)).toBe(true);
		expect(isEligibleForDecision(30, 5)).toBe(true);
	});
});

describe("decision state", () => {
	it("carries the question, the kind and the risk of the action", () => {
		const state = buildDecisionState(
			createTaskState(["a"], ["b"], new Date(), new Date(), context()),
		) as any;

		expect(state.pending_question.request_id).toBe("q-123");
		expect(state.pending_question.kind).toBe("approval");
		expect(state.pending_question.text).toContain("toggle buttons");
		expect(state.pending_question.proposed_action).toBe(
			"implement the toggle buttons",
		);
		expect(state.pending_question.consequence_of_approval).toBe(
			"the button files change",
		);
		expect(state.pending_question.destructive).toBe(false);
		expect(state.pending_question.reversible).toBe(true);
	});

	it("carries the bounded task and risk context", () => {
		const state = buildDecisionState(
			createTaskState(["a"], ["b"], new Date(), new Date(), context()),
		) as any;

		expect(state.decision_context.current_task).toBe("Build the toggle");
		expect(state.decision_context.completion_ratio).toBe(0.5);
		expect(state.decision_context.validation_status).toBe(
			"no pending final tier",
		);
		expect(state.decision_context.waited_minutes).toBe(6);
		expect(state.decision_context.deadline_minutes).toBe(30);
		expect(state.decision_context.next_tasks).toHaveLength(2);
	});

	it("bounds the task lists and the question text", () => {
		const many = Array.from({ length: 50 }, (_, i) => `task ${i}`);
		const state = buildDecisionState(
			createTaskState(
				many,
				many,
				new Date(),
				new Date(),
				context({
					question: {
						requestId: "q-123",
						text: "x".repeat(MAX_QUESTION_CHARS + 500),
						kind: "approval",
					},
					nextTasks: many,
				}),
			),
		) as any;

		expect(state.task_summary.completed_list).toHaveLength(MAX_LISTED_TASKS);
		expect(state.task_summary.remaining_list).toHaveLength(MAX_LISTED_TASKS);
		expect(state.decision_context.next_tasks).toHaveLength(MAX_LISTED_TASKS);
		expect(state.pending_question.text).toHaveLength(MAX_QUESTION_CHARS);
	});

	it("has no question when there is none", () => {
		const state = buildDecisionState(
			createTaskState(["a"], ["b"], new Date(), new Date()),
		) as any;

		expect(state.pending_question).toBeNull();
	});
});

describe("decision policy", () => {
	it("never turns a clarification into an approval", () => {
		const result = applyDecisionPolicy(
			"approve",
			context({
				question: {
					requestId: "q-1",
					text: "Do you mean the toggle or the switch?",
					kind: "clarification",
				},
			}),
			{ confidence: 0.99 },
		);

		expect(result.outcome).toBe("wait");
		expect(result.appliedRule).toBe("clarification-never-approved");
	});

	it("approves a benign approval question so the timeout can work", () => {
		// The timeout exists for routine, reversible work: an agent that
		// proposes work is not a hard authorization block.
		const result = applyDecisionPolicy(
			"approve",
			context({
				question: {
					requestId: "q-1",
					text: "Want me to implement the toggle buttons now?",
					kind: "approval",
					requiresExplicitAuthorization: false,
					destructive: false,
					reversible: true,
				},
			}),
			{ confidence: 0.9 },
		);

		expect(result.outcome).toBe("approve");
		expect(result.appliedRule).toBeUndefined();
	});

	it("never approves an action that needs an explicit authorization", () => {
		const result = applyDecisionPolicy(
			"approve",
			context({
				question: {
					requestId: "q-1",
					text: "Shall I deploy to production?",
					kind: "explicit",
					requiresExplicitAuthorization: true,
				},
			}),
			{ confidence: 0.99 },
		);

		expect(result.outcome).toBe("wait");
		expect(result.appliedRule).toBe("explicit-authorization-required");
	});

	it("never approves an irreversible destructive action", () => {
		const result = applyDecisionPolicy(
			"approve",
			context({
				question: {
					requestId: "q-1",
					text: "Shall I drop the production table?",
					kind: "approval",
					destructive: true,
					reversible: false,
				},
			}),
			{ confidence: 0.99 },
		);

		expect(result.outcome).toBe("wait");
		expect(result.appliedRule).toBe("irreversible-action");
	});

	it("proceeds with caution when a destructive action is reversible", () => {
		const result = applyDecisionPolicy(
			"approve",
			context({
				question: {
					requestId: "q-1",
					text: "Shall I regenerate the snapshots?",
					kind: "approval",
					destructive: true,
					reversible: true,
				},
			}),
			{ confidence: 0.99 },
		);

		expect(result.outcome).toBe("proceed_with_caution");
		expect(result.appliedRule).toBe("destructive-action");
	});

	it("waits when the confidence is below the threshold", () => {
		const result = applyDecisionPolicy("approve", context(), {
			confidence: 0.4,
			confidenceThreshold: 0.7,
		});

		expect(result.outcome).toBe("wait");
		expect(result.appliedRule).toBe("confidence-below-threshold");
	});

	it("approves a low risk approval with a high confidence", () => {
		const result = applyDecisionPolicy("approve", context(), {
			confidence: 0.9,
			confidenceThreshold: 0.7,
		});

		expect(result.outcome).toBe("approve");
		expect(result.appliedRule).toBeUndefined();
	});

	it("keeps a wait and a reject decision", () => {
		expect(applyDecisionPolicy("wait", context()).outcome).toBe("wait");
		expect(applyDecisionPolicy("reject", context()).outcome).toBe("reject");
	});
});
