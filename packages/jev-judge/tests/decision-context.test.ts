/**
 * Decision context tests.
 *
 * A choice is only decidable when the evaluation sees what the alternatives
 * MEAN. The labels of a choice ("implement A", "A+B") do not carry the
 * meaning, the caveats or the boundaries of an option, and the beginning of
 * a long message is not where the decisive facts stand.
 *
 * The helper never decides and never authorizes: it prepares the facts and
 * names what it could not establish.
 */

import { describe, it, expect } from "bun:test";
import {
	buildChoiceDecisionContext,
	describeChoiceOption,
	deriveOptionAnchors,
	renderChoiceExcerpt,
	MAX_CHOICE_OPTIONS,
	MAX_OPTION_FACTS,
} from "../src/decision-context.js";
import { buildDecisionState, createTaskState, optionIndex } from "../src/auto-continue.js";
import {
	HONCHO_CHOICE_ALTERNATIVES,
	HONCHO_CHOICE_MESSAGE,
	HONCHO_CHOICE_QUESTION,
} from "./fixtures/honcho-choice-message.js";

const HONCHO_MESSAGE = HONCHO_CHOICE_MESSAGE;
const HONCHO_QUESTION = HONCHO_CHOICE_QUESTION;
const HONCHO_ALTERNATIVES = HONCHO_CHOICE_ALTERNATIVES;

describe("the anchors of an option", () => {
	it("names the option by its short label", () => {
		expect(deriveOptionAnchors("implement A")).toEqual(["A"]);
		expect(deriveOptionAnchors("A+B")).toEqual(["A+B", "A", "B"]);
	});
});

describe("the decision context of a choice", () => {
	it("keeps the meaning of both alternatives", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
		});

		expect(context.options).toHaveLength(2);
		expect(context.options[0]?.description).toContain("Truthful reporting only");
		expect(context.options[1]?.description).toContain("Become the connector");
	});

	it("keeps the caveat of the second alternative", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
		});

		const constraints = (context.options[1]?.constraints ?? []).join(" ");
		expect(constraints).toContain("must actually connect");
		expect(constraints).toContain("not just listen");
	});

	it("keeps a decisive caveat that stands behind the two thousandth character", () => {
		// The prefix of the message does not contain the caveat: a truncation
		// policy that keeps the first characters would lose it.
		expect(HONCHO_MESSAGE.indexOf("must actually connect")).toBeGreaterThan(2000);
		expect(HONCHO_MESSAGE.slice(0, 2000)).not.toContain("must actually connect");

		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
		});

		expect((context.options[1]?.constraints ?? []).join(" ")).toContain(
			"must actually connect",
		);
	});

	it("keeps a constraint of the section of an option that names it with a pronoun", () => {
		// The paragraph stands in the section of the option and names it with
		// a pronoun. It is about that option: dropping it would hide the
		// restriction of the option without any warning.
		const context = buildChoiceDecisionContext({
			question: "Should I take A or B?",
			alternatives: ["A", "B"],
			contextText: [
				"**A. The small fix.**",
				"",
				"It only changes the message of the app.",
				"",
				"**B. The connector.**",
				"",
				"It must actually connect servers.",
				"",
				"Should I take A or B?",
			].join("\n"),
		});

		expect(context.options[1]?.constraints.join(" ")).toContain(
			"must actually connect",
		);
		expect(renderChoiceExcerpt(context)).toContain("must actually connect");
		expect(context.source.complete).toBe(true);
	});

	it("keeps a constraint that names the option in a message without option headers", () => {
		// Without a header there is no section, so the paragraph that names
		// the option is the only thing that can carry the fact.
		const context = buildChoiceDecisionContext({
			question: "Should I take A or B?",
			alternatives: ["A", "B"],
			contextText: [
				"Option B reports the registration as connected.",
				"",
				"Option B must actually connect the servers.",
			].join("\n"),
		});

		expect(context.options[1]?.description).toContain(
			"reports the registration as connected",
		);
		expect(context.options[1]?.constraints.join(" ")).toContain(
			"must actually connect",
		);
	});

	it("keeps the constraints of the message when the agent supplied a description", () => {
		// The description of the agent is the meaning of the option, not a
		// replacement for the facts of the message: a caveat that only the
		// message carries has to survive it.
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
			structured: {
				options: [
					{ label: "implement A", description: "report the registration as connected" },
					{
						label: "A+B",
						description: "connect the registered servers ourselves",
						constraints: [],
					},
				],
			},
		});

		expect(context.options[1]?.description).toBe(
			"connect the registered servers ourselves",
		);
		expect(context.options[1]?.constraints.join(" ")).toContain(
			"must actually connect",
		);
		// The wording of the source for the option survives as well.
		expect(context.options[1]?.tradeoffs.join(" ")).toContain(
			"Become the connector",
		);
	});

	it("finds the section of an option when the alternatives are in another order", () => {
		// The order of the alternatives is not the order of the sections: the
		// label "A" belongs to the first option, so the header of "A+B" is
		// not the header of the option "A".
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: ["A+B", "implement A"],
			contextText: HONCHO_MESSAGE,
		});

		expect(context.options[0]?.description).toContain("Become the connector");
		expect(context.options[1]?.description).toContain("Truthful reporting only");
		expect(context.options[0]?.constraints.join(" ")).toContain(
			"must actually connect",
		);
	});

	it("never chooses an option and never invents an approval", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
		});

		expect(context.authorization.approved).toEqual([]);
		expect(context.authorization.notEstablished.join(" ")).toContain(
			"no human selection between the alternatives",
		);
		// The approval of an earlier action is not an authorization of this
		// choice, and it stays visible as such.
		expect(context.authorization.notEstablished.join(" ")).toContain(
			"does not establish a selection between the alternatives",
		);
		expect(JSON.stringify(context)).not.toContain("selectedOption");
	});

	it("reports that the earlier turns of the conversation are missing", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
		});

		expect(context.uncertainties.join(" ")).toContain(
			"the earlier turns of the conversation were not supplied",
		);
		expect(context.source.omittedInformation.join(" ")).toContain(
			"the earlier turns of the conversation were not supplied",
		);
	});

	it("keeps a context that only exists in an earlier message missing", () => {
		// The message refers to an earlier explanation: the runtime does not
		// have it, so the helper says so instead of guessing.
		const context = buildChoiceDecisionContext({
			question: "Should I take A or A+B, as described above?",
			alternatives: ["A", "A+B"],
			contextText:
				"Should I take A or A+B, as described above? The two options are the ones I explained in my previous message.",
		});

		expect(context.options.every((option) => option.description === "")).toBe(true);
		expect(context.uncertainties.join(" ")).toContain(
			"the source does not state what this option means",
		);
		expect(context.source.complete).toBe(false);
	});

	it("prefers the facts the agent supplied over the message", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
			structured: {
				problem: "the registration succeeds while the model has no tools",
				options: [
					{ label: "implement A", description: "report registered as connected" },
					{ label: "A+B", description: "connect the servers ourselves" },
				],
				authorization: { approved: [], notEstablished: ["nothing is authorized"] },
			},
		});

		expect(context.problem).toBe(
			"the registration succeeds while the model has no tools",
		);
		expect(context.options[0]?.description).toBe("report registered as connected");
		// The meaning comes from the structure, the constraints of the
		// message are merged with it: the provenance says so.
		expect(context.source.derived).toBe("mixed");
		expect(context.authorization.notEstablished).toEqual(["nothing is authorized"]);
	});

	it("reports malformed supplied facts instead of throwing", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
			structured: {
				options: [
					{ label: "implement A", description: 42 as unknown as string },
					{ label: "A+B" },
				],
			},
		});

		expect(context.uncertainties.join(" ")).toContain(
			"the supplied description is empty or malformed",
		);
		// The message is the fallback, and it still carries the meaning.
		expect(context.options[0]?.description).toContain("Truthful reporting only");
		expect(context.options[1]?.description).toContain("Become the connector");
	});

	it("does not let a common word become a fact of an option", () => {
		// "make it so" has no identifier in it: the word "so" appears in
		// every other sentence of the message, and it must not turn every
		// paragraph into a fact of the option.
		const context = buildChoiceDecisionContext({
			question: "Should I make it so, or leave it?",
			alternatives: ["make it so", "leave it"],
			contextText: [
				"The build is red so the release is late.",
				"The team can make it so or leave it.",
				"Either way the release is late so the note stays.",
			].join("\n\n"),
		});

		expect(context.options[0]?.description).toBe("");
		expect(context.options[0]?.tradeoffs).toEqual([]);
		expect(context.uncertainties.join(" ")).toContain(
			"the source does not state what this option means",
		);
	});

	it("matches a labelled supplied option by its label and not by its position", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
			structured: {
				options: [
					{ label: "A+B", description: "the second one" },
					{ label: "implement A", description: "the first one" },
				],
			},
		});

		expect(context.options[0]?.description).toBe("the first one");
		expect(context.options[1]?.description).toBe("the second one");
	});

	it("keeps the option ids stable and mappable to the alternatives", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
		});

		expect(context.options[0]?.id).toBe("option_1");
		expect(context.options[1]?.id).toBe("option_2");
		expect(HONCHO_ALTERNATIVES[optionIndex("option_2") as number]).toBe("A+B");
	});

	it("reports the provenance and the completeness of the facts", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
		});

		expect(context.source.originalChars).toBe(HONCHO_MESSAGE.length);
		expect(context.source.derived).toBe("extracted");
		expect(context.source.complete).toBe(true);
		expect(Array.isArray(context.source.omittedInformation)).toBe(true);
	});

	it("bounds the facts it hands over", () => {
		const many = Array.from({ length: 20 }, (_, index) => `option ${index}`);
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: many,
			contextText: HONCHO_MESSAGE,
		});

		expect(context.options.length).toBeLessThanOrEqual(MAX_CHOICE_OPTIONS);
		for (const option of context.options) {
			expect(option.tradeoffs.length).toBeLessThanOrEqual(MAX_OPTION_FACTS);
			expect(option.constraints.length).toBeLessThanOrEqual(MAX_OPTION_FACTS);
		}
		expect(context.source.omittedInformation.join(" ")).toContain(
			"did not reach the evaluation",
		);
	});
});

describe("the evaluation input of a choice", () => {
	it("carries the decision facts into the serialized state", () => {
		const state = buildDecisionState(
			createTaskState(["a"], ["b"], new Date(), new Date(), {
				question: {
					requestId: "q-1",
					text: HONCHO_QUESTION,
					kind: "choice",
					alternatives: HONCHO_ALTERNATIVES,
					contextText: HONCHO_MESSAGE,
				},
			}),
		) as any;

		const choice = state.pending_question.choice_context;
		expect(choice.options[0].description).toContain("Truthful reporting only");
		expect(choice.options[1].description).toContain("Become the connector");
		expect(choice.options[1].constraints.join(" ")).toContain(
			"must actually connect",
		);
		// The excerpt is the facts of the choice, not the beginning of the
		// message: the caveat stands behind the two thousandth character.
		expect(state.pending_question.context_excerpt).toContain(
			"must actually connect",
		);
		expect(JSON.stringify(state)).toContain("Truthful reporting only");
	});

	it("describes a criterion with the meaning of the option", () => {
		const description = describeChoiceOption(
			"option_2",
			"A+B",
			"connect the servers ourselves",
			["we must actually connect, not just listen"],
		);

		expect(description).toContain("option_2 (A+B)");
		expect(description).toContain("connect the servers ourselves");
		expect(description).toContain("we must actually connect");
	});

	it("leaves a question that is not a choice alone", () => {
		const state = buildDecisionState(
			createTaskState(["a"], ["b"], new Date(), new Date(), {
				question: {
					requestId: "q-2",
					text: "Do you mean the toggle or the switch?",
					kind: "clarification",
				},
			}),
		) as any;

		expect(state.pending_question.choice_context).toBeNull();
		expect(state.pending_question.context_excerpt).toBe("");
	});
});

describe("the excerpt of a choice", () => {
	it("carries the question, the options and what is not established", () => {
		const context = buildChoiceDecisionContext({
			question: HONCHO_QUESTION,
			alternatives: HONCHO_ALTERNATIVES,
			contextText: HONCHO_MESSAGE,
		});
		const excerpt = renderChoiceExcerpt(context);

		expect(excerpt).toContain(HONCHO_QUESTION);
		expect(excerpt).toContain("Truthful reporting only");
		expect(excerpt).toContain("constraint:");
		expect(excerpt).toContain("Not authorized:");
		// The decisive facts come first: a bound must not push a constraint
		// out of the evaluation input, and inside an option the constraint
		// stands before the consequences.
		const secondOption = excerpt.indexOf("option_2");
		const afterSecond = excerpt.slice(secondOption);
		const constraintAt = afterSecond.indexOf("constraint:");
		const consequenceAt = afterSecond.indexOf("consequence:");
		expect(constraintAt).toBeGreaterThanOrEqual(0);
		expect(constraintAt).toBeLessThan(
			consequenceAt === -1 ? afterSecond.length : consequenceAt,
		);
		expect(excerpt.length).toBeLessThanOrEqual(2000);
	});
});
