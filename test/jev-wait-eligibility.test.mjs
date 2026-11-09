import { test } from "node:test";
import assert from "node:assert/strict";

import {
	classifyQuestionRelevance,
	clearObsoleteWait,
	isObsoleteQuestion,
	jevWaitEligibility,
	questionRelevance,
	workStateFromTodos,
} from "../harness/jev-wait-eligibility.ts";

test("an offer of work is recognized", () => {
	assert.equal(classifyQuestionRelevance("Would you like me to add another feature?").offer, true);
	assert.equal(classifyQuestionRelevance("Do you want me to continue?").offer, true);
	assert.equal(classifyQuestionRelevance("Want me to refactor it as well?").offer, true);
	assert.equal(classifyQuestionRelevance("Should I also update the docs?").offer, true);
	assert.equal(classifyQuestionRelevance("Anything else I can do?").offer, true);
	assert.equal(classifyQuestionRelevance("Is there anything else to check?").offer, true);
});

test("a question about the request is not an offer", () => {
	assert.equal(classifyQuestionRelevance("May I deploy to production?").offer, false);
	assert.equal(classifyQuestionRelevance("Which database should I use?").offer, false);
	assert.equal(classifyQuestionRelevance("Can you approve this migration?").offer, false);
	assert.equal(classifyQuestionRelevance("Should I proceed with the plan?").offer, false);
	assert.equal(classifyQuestionRelevance("").offer, false);
	assert.equal(classifyQuestionRelevance(undefined).offer, false);
});

test("the state of the work needs work to be complete", () => {
	assert.equal(workStateFromTodos([{ status: "pending" }]), "unfinished");
	assert.equal(workStateFromTodos([{ status: "in_progress" }]), "unfinished");
	assert.equal(
		workStateFromTodos([{ status: "completed" }, { status: "pending" }]),
		"unfinished",
	);
	assert.equal(
		workStateFromTodos([{ status: "completed" }, { status: "completed" }]),
		"complete",
	);
});

test("an empty or unreadable task list is no evidence", () => {
	// No task is no proof that the request is finished: a question can be
	// the reason no task was ever created.
	assert.equal(workStateFromTodos([]), "unknown");
	assert.equal(workStateFromTodos(null), "unknown");
	assert.equal(workStateFromTodos(undefined), "unknown");
	assert.equal(workStateFromTodos([{ status: "deleted" }]), "unknown");
	// A provider that cannot be read is no evidence either.
	assert.equal(
		workStateFromTodos([{ status: "pending" }], { available: false }),
		"unknown",
	);
	assert.equal(
		workStateFromTodos([{ status: "completed" }], { available: false }),
		"unknown",
	);
});

test("an offer never reaches the judge", () => {
	const decision = jevWaitEligibility({
		relevance: "optional-offer",
		work: "unfinished",
	});
	assert.equal(decision.eligible, false);
	assert.match(decision.reason, /not asked for/);
});

test("a question about work that is done is obsolete", () => {
	const decision = jevWaitEligibility({
		relevance: "current-request",
		work: "complete",
	});
	assert.equal(decision.eligible, false);
	assert.match(decision.reason, /obsolete/);
});

test("a question about work that remains keeps its policy", () => {
	const decision = jevWaitEligibility({
		relevance: "current-request",
		work: "unfinished",
	});
	assert.equal(decision.eligible, true);
});

test("an unknown state of the work is never a completion", () => {
	const decision = jevWaitEligibility({
		relevance: "current-request",
		work: "unknown",
	});
	assert.equal(decision.eligible, true);
	assert.match(decision.reason, /unknown/);
});

test("a final question of a finished request is not obsolete", () => {
	// The work was already done when the question was asked: there is no
	// work that could finish later, so the question is not obsolete.
	assert.equal(
		isObsoleteQuestion({ relevance: "final-request", work: "complete" }).obsolete,
		false,
	);
	assert.equal(
		isObsoleteQuestion({ relevance: "current-request", work: "complete" }).obsolete,
		true,
	);
	assert.equal(
		isObsoleteQuestion({ relevance: "current-request", work: "unfinished" }).obsolete,
		false,
	);
	assert.equal(
		isObsoleteQuestion({ relevance: "current-request", work: "unknown" }).obsolete,
		false,
	);
});

test("the relevance follows the wording and the state of the work", () => {
	assert.equal(
		questionRelevance({ text: "Would you like me to add a feature?", work: "complete" }),
		"optional-offer",
	);
	assert.equal(
		questionRelevance({ text: "May I deploy?", work: "unfinished" }),
		"current-request",
	);
	assert.equal(
		questionRelevance({ text: "May I deploy?", work: "complete" }),
		"final-request",
	);
});

test("clearing an obsolete wait ends the question and the wait together", () => {
	const calls = [];
	clearObsoleteWait({
		requestId: "question-1",
		cancelQuestion: (reason) => calls.push(["question", reason]),
		cancelWait: () => calls.push(["wait", null]),
		removeRow: (requestId) => calls.push(["row", requestId]),
	});
	assert.deepEqual(calls, [
		["question", "the work of the question is done"],
		["wait", null],
		["row", "question-1"],
	]);
});
