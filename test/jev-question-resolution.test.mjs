/**
 * The lifecycle of a pending question that nobody answered.
 *
 * The defects this suite locks down:
 *
 *  - a two-option question was classified as routine, so it never became a
 *    pending request at all,
 *  - the decision that closed the request did not say WHICH option was
 *    chosen, so the agent received a generic "continue" instead of an
 *    answer to its own question,
 *  - the 30-minute deadline paused the work but left the notification open,
 *    so the request looked like it was still waiting.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	createPendingQuestionController,
	extractAlternatives,
	hasExplicitAuthorizationWording,
} from "../packages/notification/dist/index.js";
import {
	applyDecisionPolicy,
	decideOutcomeApplication,
	isEligibleForDecision,
	optionIndex,
} from "../packages/jev-judge/dist/auto-continue.js";
import {
	buildAutonomyInstruction,
	AUTONOMY_INSTRUCTION_HEADER,
} from "../packages/jev-judge/dist/autonomy-instruction.js";
import { classifyQuestionRisk } from "../packages/jev-judge/dist/question-risk.js";

/** The message of the issue: a concrete choice with a surrounding context. */
const SAMPLE =
	"The seeder fix is validated on a small batch. I need your OK before I cross the commit boundary. " +
	"Do you want the remaining 1,228 contracts seeded, or is the current staging state intended?";

function makeController() {
	return createPendingQuestionController();
}

function questionContextOf(detection, risk) {
	return {
		requestId: "q-test",
		text: detection.questionText,
		kind: detection.kind,
		askType: detection.askType,
		alternatives: detection.alternatives,
		contextText: detection.contextText,
		requiresExplicitAuthorization: risk.requiresExplicitAuthorization,
		destructive: risk.destructive,
		reversible: risk.reversible,
		external: risk.external,
	};
}

// --- detection -------------------------------------------------------------

test("a two-option question is a choice and not a routine continuation", () => {
	const controller = makeController();
	const result = controller.detectQuestion(SAMPLE, { contextText: SAMPLE });

	assert.equal(result.detected, true);
	assert.equal(result.kind, "choice");
	assert.equal(result.askType, "choice");
	assert.equal(result.isRoutine, false);
	assert.equal(result.alternatives.length, 2);
	assert.match(result.alternatives[0], /remaining 1,228 contracts seeded/);
	assert.match(result.alternatives[1], /current staging state is intended/);
});

test("the complete message stays the context of the question", () => {
	const controller = makeController();
	const result = controller.detectQuestion(SAMPLE, { contextText: SAMPLE });

	assert.equal(result.contextText, SAMPLE);
	assert.match(result.contextText, /need your OK before I cross the commit boundary/);
	// The question sentence alone does not carry the context.
	assert.doesNotMatch(result.questionText, /need your OK/);
});

test("the alternatives of a choice are the two concrete states", () => {
	const alternatives = extractAlternatives(
		"Do you want the remaining 1,228 contracts seeded, or is the current staging state intended?",
	);
	assert.equal(alternatives.length, 2);
	assert.match(alternatives[0], /seeded/);
	assert.match(alternatives[1], /current staging state is intended/);
});

test("a long question does not make the parser slow", () => {
	// A question comes from a model, so its length is not under the
	// control of the harness. A pattern with two unbounded repetitions
	// next to each other takes quadratic time on a long run of the same
	// character, and the harness would stall on it.
	const hostile = `Do you want the ${"\t".repeat(200_000)}change, or the other state?`;
	const started = Date.now();
	const alternatives = extractAlternatives(hostile);
	const duration = Date.now() - started;
	assert.ok(duration < 2000, `the parser took ${duration}ms`);
	// The question is longer than the parser reads, so the rest of it is
	// ignored - and the parser still answers.
	assert.ok(alternatives.length <= 2);

	// A question that is short enough still names its two alternatives.
	const tabs = `Do you want the ${"\t".repeat(200)}change, or the other state?`;
	const parsed = extractAlternatives(tabs);
	assert.equal(parsed.length, 2);
	assert.match(parsed[1], /other state/);
});

test("an unrecognized question waits for a human instead of being routine", () => {
	const controller = makeController();
	const result = controller.detectQuestion(
		"The pipeline reports a different contract count than the staging ledger. Which number is authoritative?",
	);

	assert.equal(result.detected, true);
	assert.equal(result.kind, "clarification");
	assert.equal(result.askType, "clarification");
	assert.equal(result.isRoutine, false);
});

test("a request that reserves the decision for the human is an explicit authorization", () => {
	const controller = makeController();
	const result = controller.detectQuestion(
		"I need your OK before I publish the release. Should I publish the release now?",
		{
			contextText:
				"I need your OK before I publish the release. Should I publish the release now?",
		},
	);

	assert.equal(result.kind, "approval");
	assert.equal(result.askType, "explicit_authorization");
	assert.equal(hasExplicitAuthorizationWording("I need your OK"), true);
	assert.equal(hasExplicitAuthorizationWording("the batch is validated"), false);
});

test("an explicit authorization blocks the autonomous decision", () => {
	const risk = classifyQuestionRisk({
		kind: "approval",
		askType: "explicit_authorization",
		text: "I need your OK before I publish the release.",
	});
	assert.equal(risk.requiresExplicitAuthorization, true);
	assert.ok(risk.signals.includes("explicit-authorization"));
});

// --- the deterministic policy ---------------------------------------------

test("an approval of a choice keeps the selected option and the scope", () => {
	const controller = makeController();
	const detection = controller.detectQuestion(SAMPLE, { contextText: SAMPLE });
	const risk = classifyQuestionRisk({
		kind: detection.kind,
		askType: detection.askType,
		text: detection.contextText,
	});
	const context = { question: questionContextOf(detection, risk) };

	const result = applyDecisionPolicy("approve", context, {
		confidenceThreshold: 0.7,
		confidence: 0.9,
		selectedOption: detection.alternatives[0],
		scope: "canary_first",
	});

	assert.equal(result.outcome, "approve");
	assert.equal(result.appliedRule, undefined);
});

test("a cautious approval of a choice keeps the selected option and the scope", () => {
	const controller = makeController();
	const detection = controller.detectQuestion(SAMPLE, { contextText: SAMPLE });
	const risk = classifyQuestionRisk({
		kind: detection.kind,
		askType: detection.askType,
		text: detection.contextText,
	});
	const context = { question: questionContextOf(detection, risk) };

	const result = applyDecisionPolicy("proceed_with_caution", context, {
		cautionThreshold: 0.5,
		confidence: 0.6,
		selectedOption: detection.alternatives[1],
		scope: "full_scope",
	});

	assert.equal(result.outcome, "proceed_with_caution");
	assert.equal(result.appliedRule, undefined);
});

test("a choice without a selected option stays open", () => {
	const controller = makeController();
	const detection = controller.detectQuestion(SAMPLE, { contextText: SAMPLE });
	const risk = classifyQuestionRisk({
		kind: detection.kind,
		askType: detection.askType,
		text: detection.contextText,
	});
	const context = { question: questionContextOf(detection, risk) };

	const result = applyDecisionPolicy("approve", context, {
		confidenceThreshold: 0.7,
		confidence: 0.9,
		scope: "full_scope",
	});

	assert.equal(result.outcome, "wait");
	assert.equal(result.appliedRule, "choice-without-selected-option");
});

test("a choice with the scope none stays open", () => {
	const controller = makeController();
	const detection = controller.detectQuestion(SAMPLE, { contextText: SAMPLE });
	const risk = classifyQuestionRisk({
		kind: detection.kind,
		askType: detection.askType,
		text: detection.contextText,
	});
	const context = { question: questionContextOf(detection, risk) };

	const result = applyDecisionPolicy("approve", context, {
		confidenceThreshold: 0.7,
		confidence: 0.9,
		selectedOption: detection.alternatives[0],
		scope: "none",
	});

	assert.equal(result.outcome, "wait");
	assert.equal(result.appliedRule, "choice-scope-none");
});

test("a clarification is never approved", () => {
	const result = applyDecisionPolicy(
		"approve",
		{
			question: {
				requestId: "q-test",
				text: "Which number is authoritative?",
				kind: "clarification",
				askType: "clarification",
			},
		},
		{ confidenceThreshold: 0.7, confidence: 0.95, scope: "full_scope" },
	);

	assert.equal(result.outcome, "wait");
	assert.equal(result.appliedRule, "clarification-never-approved");
});

test("an explicit authorization is never approved", () => {
	const result = applyDecisionPolicy(
		"approve",
		{
			question: {
				requestId: "q-test",
				text: "Should I publish the release now?",
				kind: "approval",
				askType: "explicit_authorization",
				requiresExplicitAuthorization: true,
			},
		},
		{ confidenceThreshold: 0.7, confidence: 0.95, scope: "full_scope" },
	);

	assert.equal(result.outcome, "wait");
	assert.equal(result.appliedRule, "explicit-authorization-required");
});

test("the wait is retried until the deadline and never before the threshold", () => {
	assert.equal(isEligibleForDecision(4.9, 5), false);
	assert.equal(isEligibleForDecision(5, 5), true);
	assert.equal(isEligibleForDecision(29, 5), true);
	assert.equal(isEligibleForDecision(31, 5), true);
});

test("a wait is not a continuation: the request stays open", () => {
	// A wait means "ask again on the next poll". It never closes the
	// request and never continues the work.
	assert.equal(decideOutcomeApplication("wait", true), "wait");
	assert.equal(decideOutcomeApplication("wait", false), "wait");
	// Only a closed request may continue or pause the work.
	assert.equal(decideOutcomeApplication("approve", true), "continue");
	assert.equal(decideOutcomeApplication("approve", false), "discard");
	assert.equal(decideOutcomeApplication("reject", true), "pause");
});

test("the option index of a criterion maps back to the alternative", () => {
	assert.equal(optionIndex("option_1"), 0);
	assert.equal(optionIndex("option_2"), 1);
	assert.equal(optionIndex("none_of_these"), -1);
});

// --- the lifecycle of the request -----------------------------------------

test("a Jev decision closes the request and records the selected option", () => {
	const controller = makeController();
	const question = controller.createQuestion({
		text: "Do you want the remaining contracts seeded, or is the staging state intended?",
		sessionId: "s-1",
		workspacePath: "/tmp",
		kind: "choice",
		askType: "choice",
		alternatives: ["seed the remaining contracts", "keep the staging state"],
		contextText: SAMPLE,
	});

	const decisions = [];
	controller.onJevDecision((_question, decision) => decisions.push(decision));

	const closed = controller.resolveByJev(
		question.requestId,
		"approve",
		"the batch is validated",
		{
			selectedOption: "seed the remaining contracts",
			scope: "canary_first",
			reasoning: "the batch is validated",
		},
	);

	assert.equal(closed, true);
	const stored = controller.getQuestion(question.requestId);
	assert.equal(stored.state, "resolved");
	assert.equal(stored.resolvedBy, "jev");
	assert.equal(stored.selectedOption, "seed the remaining contracts");
	assert.equal(stored.scope, "canary_first");
	assert.equal(decisions.length, 1);
	assert.equal(decisions[0].metadata.selectedOption, "seed the remaining contracts");
	assert.equal(decisions[0].metadata.scope, "canary_first");
});

test("the deadline closes the request instead of leaving it open", () => {
	const controller = makeController();
	const question = controller.createQuestion({
		text: "Do you want the remaining contracts seeded, or is the staging state intended?",
		sessionId: "s-1",
		workspacePath: "/tmp",
		kind: "choice",
		askType: "choice",
		alternatives: ["seed the remaining contracts", "keep the staging state"],
	});

	const decisions = [];
	controller.onJevDecision((_question, decision) => decisions.push(decision));

	const expired = controller.expireByTimeout(question.requestId, "deadline-expired");

	assert.equal(expired, true);
	const stored = controller.getQuestion(question.requestId);
	assert.equal(stored.state, "expired");
	assert.equal(stored.resolvedBy, "timeout");
	assert.equal(stored.closedReason, "deadline-expired");
	assert.equal(controller.hasPendingQuestion(), false);
	assert.equal(decisions[0].metadata.outcome, "expired");
});

test("a late human answer after the deadline is ignored", () => {
	const controller = makeController();
	const question = controller.createQuestion({
		text: "Do you want the remaining contracts seeded, or is the staging state intended?",
		sessionId: "s-1",
		workspacePath: "/tmp",
		kind: "choice",
		askType: "choice",
		alternatives: ["seed the remaining contracts", "keep the staging state"],
	});

	const answers = [];
	controller.onUserAnswer((_question, answer) => answers.push(answer));

	controller.expireByTimeout(question.requestId, "deadline-expired");

	const applied = controller.applyApproval("approve", question.requestId, "telegram");
	assert.equal(applied.applied, false);
	assert.equal(answers.length, 0);
	assert.equal(controller.getQuestion(question.requestId).resolvedBy, "timeout");
});

test("a human answer wins over a stale Jev decision", () => {
	const controller = makeController();
	const question = controller.createQuestion({
		text: "Do you want the remaining contracts seeded, or is the staging state intended?",
		sessionId: "s-1",
		workspacePath: "/tmp",
		kind: "choice",
		askType: "choice",
		alternatives: ["seed the remaining contracts", "keep the staging state"],
	});

	const applied = controller.applyApproval("approve", question.requestId, "telegram");
	assert.equal(applied.applied, true);

	const closed = controller.resolveByJev(
		question.requestId,
		"approve",
		"stale decision",
		{ selectedOption: "keep the staging state", scope: "full_scope" },
	);
	assert.equal(closed, false);
	const stored = controller.getQuestion(question.requestId);
	assert.equal(stored.resolvedBy, "user");
	assert.equal(stored.selectedOption, undefined);
});

// --- the instruction of the decision --------------------------------------

test("the instruction names the selected option and never claims to be the user", () => {
	const instruction = buildAutonomyInstruction({
		outcome: "approve",
		questionText: "Do you want the remaining contracts seeded, or is the staging state intended?",
		selectedOption: "seed the remaining contracts",
		scope: "canary_first",
		reasoning: "the batch is validated",
		riskLevel: "low",
		waitedMinutes: 6,
		deadlineMinutes: 30,
	});

	assert.ok(instruction.startsWith(AUTONOMY_INSTRUCTION_HEADER));
	assert.match(instruction, /seed the remaining contracts/);
	assert.match(instruction, /canary_first/);
	assert.match(instruction, /the batch is validated/);
	// The user did not answer: the decision must not say that.
	assert.doesNotMatch(instruction, /the user (said|replied|answered|approved)/i);
	assert.match(instruction, /reply of the user always wins/i);
});
