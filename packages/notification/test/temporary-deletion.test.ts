/**
 * The refusal of a narrowly scoped deletion of a temporary path.
 *
 * The harness refuses the deletion of a temporary path on its own: the
 * answer is always "No", so neither the judge nor the human is asked. The
 * classifier is deliberately narrow, and these tests hold that narrowness:
 * every case that is not a plain deletion of a path under /tmp waits for the
 * human.
 */

import { describe, it, expect } from "bun:test";
import {
	classifyTemporaryDeletionRequest,
	createPendingQuestionController,
	TEMPORARY_DELETION_REASONS,
} from "../src/pending-question.js";

describe("classifyTemporaryDeletionRequest", () => {
	it("refuses the deletion of a temporary path", () => {
		for (const question of [
			"May I delete /tmp/pi-harness.log?",
			"May I remove /tmp/build?",
			"May I delete /tmp/a and /tmp/b?",
			"May I delete the temporary file /tmp/cache.bin?",
			"May I unlink /tmp/old.sock?",
		]) {
			const verdict = classifyTemporaryDeletionRequest(question);
			expect(verdict.applies).toBe(true);
		}
	});

	it("keeps a question that does not ask for a permission", () => {
		const verdict = classifyTemporaryDeletionRequest(
			"Should I delete /tmp/pi-harness.log?",
		);
		expect(verdict.applies).toBe(false);
		expect(verdict.reason).toBe(
			TEMPORARY_DELETION_REASONS.notAPermissionRequest,
		);
	});

	it("keeps a question that does not ask for a deletion", () => {
		for (const question of [
			"May I clean up /tmp?",
			"May I write /tmp/pi-harness.log?",
			"May I read /tmp/pi-harness.log?",
		]) {
			const verdict = classifyTemporaryDeletionRequest(question);
			expect(verdict.applies).toBe(false);
			expect(verdict.reason).toBe(TEMPORARY_DELETION_REASONS.notADeletion);
		}
	});

	it("keeps a path outside the temporary directory", () => {
		const verdict = classifyTemporaryDeletionRequest(
			"May I delete /etc/pi-harness.conf?",
		);
		expect(verdict.applies).toBe(false);
		expect(verdict.reason).toBe(TEMPORARY_DELETION_REASONS.noTemporaryPath);
	});

	it("keeps a question that names a second path", () => {
		const verdict = classifyTemporaryDeletionRequest(
			"May I delete /tmp/pi-harness.log and /etc/pi-harness.conf?",
		);
		expect(verdict.applies).toBe(false);
		expect(verdict.reason).toBe(
			TEMPORARY_DELETION_REASONS.pathOutsideTemporary,
		);
	});

	it("keeps the temporary directory itself", () => {
		const verdict = classifyTemporaryDeletionRequest("May I delete /tmp?");
		expect(verdict.applies).toBe(false);
		expect(verdict.reason).toBe(TEMPORARY_DELETION_REASONS.noTemporaryPath);
	});

	it("keeps a mixed operation", () => {
		const verdict = classifyTemporaryDeletionRequest(
			"May I delete /tmp/pi-harness.log and restart the service?",
		);
		expect(verdict.applies).toBe(false);
		expect(verdict.reason).toBe(TEMPORARY_DELETION_REASONS.unknownOperation);
	});

	it("keeps a serious operation", () => {
		for (const question of [
			"May I delete /tmp/pi-harness.log in production?",
			"May I delete /tmp/credentials.json?",
			"May I delete /tmp/payment.log?",
			"May I delete /tmp/pi-harness.log and deploy the build?",
		]) {
			const verdict = classifyTemporaryDeletionRequest(question);
			expect(verdict.applies).toBe(false);
		}
	});

	it("keeps a question that reserves the decision for the human", () => {
		const verdict = classifyTemporaryDeletionRequest(
			"May I delete /tmp/pi-harness.log with your explicit approval?",
		);
		expect(verdict.applies).toBe(false);
		expect(verdict.reason).toBe(
			TEMPORARY_DELETION_REASONS.explicitAuthorization,
		);
	});
});

describe("the detection of a permission request", () => {
	it("reads 'May I …?' as an approval question", () => {
		const controller = createPendingQuestionController({
			evaluationDelayMs: 5 * 60 * 1000,
			jevEnabled: false,
		});
		const result = controller.detectQuestion("May I delete /tmp/pi-harness.log?");
		expect(result.detected).toBe(true);
		expect(result.kind).toBe("approval");
		expect(result.askType).toBe("approval");
	});

	it("keeps the clarification precedence", () => {
		const controller = createPendingQuestionController({
			evaluationDelayMs: 5 * 60 * 1000,
			jevEnabled: false,
		});
		const result = controller.detectQuestion(
			"May I use the tokenizer or the lexer, do you mean the lexer?",
		);
		expect(result.kind).toBe("clarification");
	});
});

describe("resolveLocally", () => {
	it("closes the question with the answer 'No'", () => {
		const controller = createPendingQuestionController({
			evaluationDelayMs: 5 * 60 * 1000,
			jevEnabled: false,
		});
		const question = controller.createQuestion({
			text: "May I delete /tmp/pi-harness.log?",
			sessionId: "session-1",
			workspacePath: "/tmp",
			kind: "approval",
		});
		const closed = controller.resolveLocally(
			question.requestId,
			"no",
			"temporary-path-deletion-refusal",
		);
		expect(closed).toBe(true);
		const stored = controller.getQuestion(question.requestId);
		expect(stored?.state).toBe("resolved");
		expect(stored?.resolution).toBe("no");
		expect(stored?.localDecision).toBe("no");
		expect(stored?.closedReason).toBe("temporary-path-deletion-refusal");
		// Nobody was asked and nobody answered: the question is not an
		// answer of the human and not a decision of the judge.
		expect(stored?.resolvedBy).toBeUndefined();
		expect(stored?.jevOutcome).toBeUndefined();
	});

	it("refuses a stale request ID", () => {
		const controller = createPendingQuestionController({
			evaluationDelayMs: 5 * 60 * 1000,
			jevEnabled: false,
		});
		const question = controller.createQuestion({
			text: "May I delete /tmp/pi-harness.log?",
			sessionId: "session-1",
			workspacePath: "/tmp",
			kind: "approval",
		});
		expect(controller.resolveLocally("q-unknown", "no", "refusal")).toBe(false);
		expect(controller.getQuestion(question.requestId)?.state).toBe("pending");
	});

	it("refuses a second decision on a closed question", () => {
		const controller = createPendingQuestionController({
			evaluationDelayMs: 5 * 60 * 1000,
			jevEnabled: false,
		});
		const question = controller.createQuestion({
			text: "May I delete /tmp/pi-harness.log?",
			sessionId: "session-1",
			workspacePath: "/tmp",
			kind: "approval",
		});
		expect(
			controller.resolveLocally(question.requestId, "no", "refusal"),
		).toBe(true);
		expect(
			controller.resolveLocally(question.requestId, "no", "refusal"),
		).toBe(false);
	});

	it("does not notify the answer of the user", () => {
		const controller = createPendingQuestionController({
			evaluationDelayMs: 5 * 60 * 1000,
			jevEnabled: false,
		});
		const answers: string[] = [];
		controller.onUserAnswer((_question, answer) => {
			answers.push(answer);
		});
		const question = controller.createQuestion({
			text: "May I delete /tmp/pi-harness.log?",
			sessionId: "session-1",
			workspacePath: "/tmp",
			kind: "approval",
		});
		controller.resolveLocally(question.requestId, "no", "refusal");
		expect(answers).toEqual([]);
	});
});
