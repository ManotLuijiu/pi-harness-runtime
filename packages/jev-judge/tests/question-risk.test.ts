/**
 * The risk facts of a pending question.
 *
 * The autonomous decision is only as safe as the facts it rests on: a
 * question that asks for permission for a destructive or irreversible
 * action must never be approved while the user is away.
 */

import { describe, it, expect } from "bun:test";
import { classifyQuestionRisk, extractProposedAction } from "../src/question-risk.js";

describe("classifyQuestionRisk", () => {
	describe("a routine continuation question", () => {
		it("is harmless enough for an autonomous decision", () => {
			const risk = classifyQuestionRisk({
				kind: "routine",
				text: "Should I continue with the remaining tasks?",
			});

			expect(risk.requiresExplicitAuthorization).toBe(false);
			expect(risk.destructive).toBe(false);
			expect(risk.reversible).toBe(true);
			expect(risk.external).toBe(false);
		});
	});

	describe("a question that asks for permission", () => {
		it("keeps a benign approval question auto-approvable", () => {
			const risk = classifyQuestionRisk({
				kind: "approval",
				text: "Want me to implement the toggle buttons now?",
			});

			// The timeout exists for routine, reversible work: the agent
			// proposing work is not a hard authorization block.
			expect(risk.requiresExplicitAuthorization).toBe(false);
			expect(risk.destructive).toBe(false);
			expect(risk.reversible).toBe(true);
		});

		it("needs an explicit authorization for an explicit question", () => {
			const risk = classifyQuestionRisk({
				kind: "explicit",
				text: "Shall I push the release?",
			});

			expect(risk.requiresExplicitAuthorization).toBe(true);
		});

		it("needs an explicit authorization for a risky approval question", () => {
			const risk = classifyQuestionRisk({
				kind: "approval",
				text: "Want me to remove the old config file now?",
			});

			expect(risk.requiresExplicitAuthorization).toBe(true);
			expect(risk.destructive).toBe(true);
		});
	});

	describe("a destructive action", () => {
		it("is destructive even in a routine question", () => {
			const risk = classifyQuestionRisk({
				kind: "routine",
				text: "Should I remove the old config file now?",
			});

			expect(risk.destructive).toBe(true);
			expect(risk.requiresExplicitAuthorization).toBe(true);
			expect(risk.reversible).toBe(false);
		});

		it("recognizes a dropped database table", () => {
			const risk = classifyQuestionRisk({
				kind: "routine",
				text: "Should I drop table users from the dev database?",
			});

			expect(risk.destructive).toBe(true);
			expect(risk.reversible).toBe(false);
		});

		it("recognizes a force push", () => {
			const risk = classifyQuestionRisk({
				kind: "routine",
				text: "Should I git push --force to the remote?",
			});

			expect(risk.destructive).toBe(true);
		});
	});

	describe("an uncertain question", () => {
		it("waits when the kind is unknown", () => {
			const risk = classifyQuestionRisk({ text: "Should I go on?" });

			expect(risk.requiresExplicitAuthorization).toBe(true);
			expect(risk.signals).toContain("unknown-question");
		});

		it("waits when the text is empty", () => {
			const risk = classifyQuestionRisk({ kind: "routine", text: "   " });

			expect(risk.requiresExplicitAuthorization).toBe(true);
			expect(risk.signals).toContain("unknown-question");
		});
	});

	describe("an action that reaches the outside world", () => {
		it("is external", () => {
			const risk = classifyQuestionRisk({
				kind: "routine",
				text: "Should I deploy to production now?",
			});

			expect(risk.external).toBe(true);
			expect(risk.requiresExplicitAuthorization).toBe(true);
		});

		it("recognizes a message to the users", () => {
			const risk = classifyQuestionRisk({
				kind: "routine",
				text: "Should I send the announcement email to all customers?",
			});

			expect(risk.external).toBe(true);
		});
	});
});

describe("the action that is proposed", () => {
	it("is extracted from the message, not from the whole message", () => {
		const action = extractProposedAction(
			"The parser is slow. I will refactor the tokenizer. May I proceed?",
			"May I proceed?",
		);

		// The sentence that states what happens is the action. The question
		// sentence is not: it asks, it does not act.
		expect(action).toContain("refactor the tokenizer");
		expect(action).not.toContain("May I proceed?");
	});

	it("falls back to the question when the message names no action", () => {
		const action = extractProposedAction("May I proceed?", "May I proceed?");

		expect(action).toBe("May I proceed?");
	});

	it("does not turn a prohibition into a proposal", () => {
		const risk = classifyQuestionRisk({
			kind: "approval",
			text: "Should I proceed?",
			proposedAction: "do not delete anything from the workspace",
		});

		// The words of a prohibition are not a destructive action.
		expect(risk.destructive).toBe(false);
		expect(risk.requiresExplicitAuthorization).toBe(false);
	});

	it("still sees the destructive action when it is proposed", () => {
		const risk = classifyQuestionRisk({
			kind: "approval",
			text: "Should I proceed?",
			proposedAction: "delete the release branch",
		});

		expect(risk.destructive).toBe(true);
		expect(risk.requiresExplicitAuthorization).toBe(true);
	});

	it("does not let a negation of another clause hide the action", () => {
		const risk = classifyQuestionRisk({
			kind: "approval",
			text: "Should I proceed?",
			proposedAction: "delete the branch, do not touch main",
		});

		// The negation belongs to the second clause: the deletion stands.
		expect(risk.destructive).toBe(true);
	});

	it("keeps a question that names no action harmless", () => {
		const risk = classifyQuestionRisk({
			kind: "approval",
			text: "Want me to implement the toggle buttons now?",
		});

		expect(risk.requiresExplicitAuthorization).toBe(false);
	});
});
