/**
 * The separation of "keep the question open" and "let the judge answer it".
 *
 * Two decisions that used to be one:
 *
 *  - the question is registered, so it holds the continuation and the human
 *    can answer it,
 *  - the wait counts down, so the judge may answer the question by silence.
 *
 * A question that offers work that was not asked for keeps the first and
 * loses the second: it stays open, and its silence decides nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/** The part of the extension that creates the pending question. */
function creationSource() {
	const start = indexSource.indexOf("const relevance = questionRelevance({");
	assert.notEqual(start, -1, "the relevance of the question is decided in the extension");
	const end = indexSource.indexOf("// Track pending user prompts", start);
	assert.notEqual(end, -1, "the creation of the question is bounded");
	return indexSource.slice(start, end);
}

test("the registration is decided before the question is created", () => {
	const body = creationSource();
	const registration = body.indexOf("jevWaitRegistration(");
	const create = body.indexOf("pqController.createQuestion(");
	assert.ok(registration >= 0, "the registration of the question is decided");
	assert.ok(registration < create, "a question that is not registered is never created");
});

test("the wait counts down only when the judge may answer the question", () => {
	const body = creationSource();
	const create = body.indexOf("pqController.createQuestion(");
	const eligibility = body.indexOf("jevWaitEligibility(");
	const begin = body.indexOf("waitLifecycle.begin(");
	assert.ok(eligibility > create, "the question is open before the countdown is decided");
	assert.ok(begin > eligibility, "the countdown starts after the decision");
	assert.match(
		body,
		/if \(eligibility\.eligible\) \{\s*waitLifecycle\.begin\(/,
		"the wait starts only inside the branch that allows it",
	);
});
