/**
 * The path from a question to the facts of a decision.
 *
 * The detection layer extracts the alternatives of a choice, and the
 * decision context turns the surrounding message into what those
 * alternatives MEAN. The two halves belong together: a label without its
 * meaning cannot be decided about.
 */

import { describe, it, expect } from "bun:test";
import { createPendingQuestionController } from "../../notification/src/pending-question.js";
import { buildChoiceDecisionContext } from "../src/decision-context.js";
import {
	HONCHO_CHOICE_ALTERNATIVES,
	HONCHO_CHOICE_MESSAGE,
	HONCHO_CHOICE_QUESTION,
} from "./fixtures/honcho-choice-message.js";

function detect(): {
	questionText: string;
	alternatives: string[];
	contextText: string;
} {
	const controller = createPendingQuestionController({
		evaluationDelayMs: 5 * 60 * 1000,
		jevEnabled: false,
	});
	const result = controller.detectQuestion(HONCHO_CHOICE_QUESTION, {
		contextText: HONCHO_CHOICE_MESSAGE,
	});
	return {
		questionText: result.questionText ?? HONCHO_CHOICE_QUESTION,
		alternatives: result.alternatives ?? [],
		contextText: result.contextText ?? HONCHO_CHOICE_MESSAGE,
	};
}

describe("a choice question and its decision context", () => {
	it("is detected as a choice with its two alternatives", () => {
		const result = detect();

		expect(result.alternatives).toEqual(HONCHO_CHOICE_ALTERNATIVES);
	});

	it("gives the evaluation the meaning of both alternatives", () => {
		const result = detect();
		const context = buildChoiceDecisionContext({
			question: result.questionText,
			alternatives: result.alternatives,
			contextText: result.contextText,
		});

		expect(context.options[0]?.description).toContain("Truthful reporting only");
		expect(context.options[1]?.description).toContain("Become the connector");
	});

	it("keeps the caveat that stands behind the two thousandth character", () => {
		const result = detect();
		const context = buildChoiceDecisionContext({
			question: result.questionText,
			alternatives: result.alternatives,
			contextText: result.contextText,
		});

		expect(HONCHO_CHOICE_MESSAGE.indexOf("must actually connect")).toBeGreaterThan(
			2000,
		);
		expect((context.options[1]?.constraints ?? []).join(" ")).toContain(
			"must actually connect",
		);
	});

	it("does not report a human selection that did not happen", () => {
		const result = detect();
		const context = buildChoiceDecisionContext({
			question: result.questionText,
			alternatives: result.alternatives,
			contextText: result.contextText,
		});

		expect(context.authorization.approved).toEqual([]);
		expect(context.authorization.notEstablished.join(" ")).toContain(
			"no human selection between the alternatives",
		);
	});
});
