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

test("the requested scope decides, not the wording", () => {
	// "Want me to implement A, or A+B?" is phrased like an offer and asks
	// about the request itself. The scope of the request is what decides.
	const scope = ["Implement A"];
	const genuine = questionRelevance({
		text: "Want me to implement A, or A+B?",
		work: "unfinished",
		scope,
	});
	assert.equal(genuine, "current-request", "the question asks about the requested scope");

	const offer = questionRelevance({
		text: "May I add an export feature?",
		work: "unfinished",
		scope,
	});
	assert.equal(offer, "optional-offer", "the question proposes work the request does not name");
});

test("the scope comparison uses the action of the question", () => {
	// The message around the question talks about many things. Only the
	// action of the question is compared with the scope.
	const scope = ["Implement A"];
	const question = questionRelevance({
		text: "The repository has an export feature. May I add an export feature?",
		work: "unfinished",
		scope,
		action: "May I add an export feature?",
	});
	assert.equal(question, "optional-offer");
});

test("without a scope the wording is the fallback", () => {
	// The scope is unknown: the wording is the only evidence there is.
	assert.equal(
		questionRelevance({ text: "Would you like me to add a feature?", work: "unfinished" }),
		"optional-offer",
	);
	assert.equal(
		questionRelevance({ text: "May I apply the migration?", work: "unfinished" }),
		"current-request",
	);
});

test("a question after the completion is not decided by silence", () => {
	// The wording of an offer is not the only way to offer work: "May I add
	// an export feature?" asks a question and still proposes something that
	// was not asked for.
	const work = workStateFromTodos([{ status: "completed" }]);
	assert.equal(work, "complete");

	const relevance = questionRelevance({
		text: "May I add an export feature?",
		work,
	});
	assert.equal(relevance, "final-request");

	const decision = jevWaitEligibility({ relevance, work });
	assert.equal(
		decision.eligible,
		false,
		"the request is done, so the question waits for an explicit request",
	);
	assert.match(decision.reason, /explicit request/);
});

test("a pending validation is work that remains", () => {
	const items = [{ status: "completed" }, { status: "completed" }];
	assert.equal(workStateFromTodos(items), "complete");
	assert.equal(
		workStateFromTodos(items, { validationPending: true }),
		"unfinished",
		"a todo whose final tier has not passed is not done",
	);
	assert.equal(
		workStateFromTodos(items, { validationPending: false }),
		"complete",
	);
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
	// work that could finish later, so the question is not obsolete. It is
	// still not eligible: the request is done, so it waits for the user.
	assert.equal(
		isObsoleteQuestion({ relevance: "final-request", work: "complete" }).obsolete,
		false,
	);
	assert.equal(
		jevWaitEligibility({ relevance: "final-request", work: "complete" }).eligible,
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
