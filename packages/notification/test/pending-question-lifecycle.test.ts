/**
 * Pending question lifecycle tests.
 *
 * One question, one canonical request ID, one resolver. A stale, duplicated
 * or unauthorized callback resolves nothing, the first human answer wins, and
 * an autonomous Jev decision is never reported as a user answer.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	PendingQuestionController,
	type JevOutcome,
} from "../src/pending-question.js";

describe("pending question lifecycle", () => {
	let controller: PendingQuestionController;
	let requestId: string;

	beforeEach(() => {
		controller = new PendingQuestionController();
		const question = controller.createQuestion({
			text: "Want me to implement the toggle buttons now?",
			sessionId: "session-1",
			workspacePath: "/tmp",
			kind: "approval",
		});
		requestId = question.requestId;
	});

	describe("the risk facts of a question", () => {
		it("keeps the recorded risk facts with the request", () => {
			const local = new PendingQuestionController();
			const question = local.createQuestion({
				text: "Shall I drop the production table?",
				sessionId: "session-1",
				workspacePath: "/tmp",
				kind: "approval",
				risk: {
					requiresExplicitAuthorization: true,
					destructive: true,
					reversible: false,
					external: true,
					signals: ["drop-object", "production"],
				},
			});

			expect(question.requiresExplicitAuthorization).toBe(true);
			expect(question.destructive).toBe(true);
			expect(question.reversible).toBe(false);
			expect(question.external).toBe(true);
			expect(question.riskSignals).toContain("drop-object");

			// The facts travel with the request.
			expect(local.getCurrentQuestion()?.destructive).toBe(true);
		});

		it("leaves the facts unknown when they were not determined", () => {
			const local = new PendingQuestionController();
			const question = local.createQuestion({
				text: "Should I continue?",
				sessionId: "session-1",
				workspacePath: "/tmp",
				kind: "routine",
			});

			expect(question.requiresExplicitAuthorization).toBeUndefined();
			expect(question.destructive).toBeUndefined();
			expect(question.reversible).toBeUndefined();
		});
	});

	describe("stale and unauthorized callbacks", () => {
		it("ignores a callback with a stale request ID", () => {
			const applied = controller.applyApproval("approve", "q-not-the-question", "telegram");

			expect(applied.applied).toBe(false);
			// The current question is untouched.
			expect(controller.hasPendingQuestion()).toBe(true);
			expect(controller.getResolution()).toBeUndefined();
		});

		it("ignores a duplicate click", () => {
			const first = controller.applyApproval("approve", requestId, "telegram");
			const second = controller.applyApproval("approve", requestId, "telegram");

			expect(first.applied).toBe(true);
			expect(second.applied).toBe(false);
			expect(controller.getResolution()).toBe("yes");
			// The first answer wins, the duplicate changes nothing.
			expect(controller.getCurrentQuestion()?.resolvedChannel).toBe("telegram");
		});

		it("ignores an unknown action", () => {
			const applied = controller.applyApproval("explode", requestId, "telegram");

			expect(applied.applied).toBe(false);
			expect(controller.hasPendingQuestion()).toBe(true);
		});

		it("reports a closed question as not actionable", () => {
			expect(controller.isActionable(requestId)).toBe(true);

			controller.applyApproval("approve", requestId, "telegram");

			expect(controller.isActionable(requestId)).toBe(false);
			expect(controller.isActionable("q-another")).toBe(false);
		});
	});

	describe("first answer wins", () => {
		it("keeps the Telegram answer when LINE answers later", () => {
			const telegram = controller.applyApproval("approve", requestId, "telegram");
			const line = controller.applyApproval("reject", requestId, "line");

			expect(telegram.applied).toBe(true);
			expect(line.applied).toBe(false);
			expect(controller.getResolution()).toBe("yes");
			expect(controller.getCurrentQuestion()?.resolvedChannel).toBe("telegram");
		});

		it("does not let Jev overwrite a human answer", () => {
			controller.applyApproval("approve", requestId, "line");

			const closed = controller.resolveByJev(requestId, "reject", "jev decided");

			expect(closed).toBe(false);
			expect(controller.getResolution()).toBe("yes");
			expect(controller.getCurrentQuestion()?.jevOutcome).toBeUndefined();
			expect(controller.getCurrentQuestion()?.resolvedBy).toBe("user");
		});
	});

	describe("a Jev decision", () => {
		it("closes the question without injecting a user answer", () => {
			const answers: string[] = [];
			controller.onUserAnswer((_question, answer) => {
				answers.push(answer);
			});
			const decisions: string[] = [];
			controller.onJevDecision((_question, decision) => {
				decisions.push(decision.action);
			});

			const closed = controller.resolveByJev(requestId, "approve", "low risk");

			expect(closed).toBe(true);
			// No synthetic "yes" is dispatched as if a human had clicked.
			expect(answers).toHaveLength(0);
			expect(decisions).toEqual(["continue"]);

			const question = controller.getCurrentQuestion();
			expect(question?.resolvedBy).toBe("jev");
			expect(question?.jevOutcome).toBe("approve");
			expect(question?.jevReason).toBe("low risk");
			expect(question?.resolvedChannel).toBeUndefined();
			// A closed question is not a pending question any more.
			expect(controller.hasPendingQuestion()).toBe(false);
			expect(controller.isActionable(requestId)).toBe(false);
		});

		it("maps every outcome to the question state", () => {
			const outcomes: JevOutcome[] = [
				"approve",
				"reject",
				"wait",
				"proceed_with_caution",
			];

			for (const outcome of outcomes) {
				const local = new PendingQuestionController();
				const question = local.createQuestion({
					text: "Want me to continue?",
					sessionId: "session-1",
					workspacePath: "/tmp",
					kind: "approval",
				});

				const closed = local.resolveByJev(question.requestId, outcome, "reason");

				expect(closed).toBe(true);
				expect(local.getCurrentQuestion()?.jevOutcome).toBe(outcome);
				expect(local.getCurrentQuestion()?.resolvedBy).toBe("jev");
				expect(local.hasPendingQuestion()).toBe(false);
			}
		});

		it("ignores a Jev decision for an unknown request", () => {
			const closed = controller.resolveByJev("q-not-the-question", "approve");

			expect(closed).toBe(false);
			expect(controller.hasPendingQuestion()).toBe(true);
			expect(controller.getCurrentQuestion()?.resolvedBy).toBeUndefined();
		});
	});
});
