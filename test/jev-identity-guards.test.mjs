/**
 * The identity guards around the asynchronous checks of the Jev.
 *
 * Two defects are locked down here:
 *
 *  - the reconciliation captured a question, read the state of the work with
 *    an await, and then closed whichever question was current. A question
 *    that replaced the captured one was closed by the check of the old one.
 *  - the decision of the judge was checked for eligibility with an await and
 *    then applied without checking the ownership again. A question that
 *    replaced the evaluated one was paused by the decision of the old one.
 *
 * The guards live in the wiring of the extension, so this suite reads the
 * source and asserts the order of the statements: the guard has to be
 * between the await and the mutation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ownsQuestion } from "../harness/jev-wait-eligibility.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/** The body of one function of the extension. */
function bodyOf(source, name) {
	const declaration = `const ${name} = async (`;
	const statement = `async function ${name}(`;
	const start = Math.max(source.indexOf(declaration), source.indexOf(statement));
	assert.notEqual(start, -1, `the function ${name} is in the extension`);
	const end = source.indexOf("\n\t\t};", start);
	assert.notEqual(end, -1, `the function ${name} is closed`);
	return source.slice(start, end);
}

test("the guard of the reconciliation is between the await and the cancel", () => {
	const body = bodyOf(indexSource, "reconcileObsoleteQuestion");
	const read = body.indexOf("await currentWorkState()");
	const guard = body.indexOf("ownsQuestion(current, requestId)");
	const close = body.indexOf("clearObsoleteWait(");
	assert.ok(read >= 0, "the state of the work is read with an await");
	assert.ok(guard > read, "the identity is checked after the await");
	assert.ok(close > guard, "the question is closed after the identity is checked");
});

test("the cancel of the reconciliation acts on the checked question only", () => {
	const body = bodyOf(indexSource, "reconcileObsoleteQuestion");
	const cancel = body.indexOf("cancelQuestion:");
	const guard = body.indexOf("ownsQuestion(still, requestId)");
	assert.ok(cancel >= 0, "the question is closed through the helper");
	assert.ok(guard > cancel, "the cancel checks the identity of the question");
});

test("the decision checks the ownership again after the await", () => {
	const body = bodyOf(indexSource, "applyWaitDecision");
	const read = body.indexOf("await currentWaitEligibility()");
	const guard = body.indexOf("ownsEvaluation(evaluation)", body.indexOf("await currentWaitEligibility()"));
	const pause = body.indexOf("explicitPause");
	assert.ok(read >= 0, "the eligibility is read with an await");
	assert.ok(guard > read, "the ownership is checked again after the await");
	assert.ok(pause > guard, "the work is paused after the ownership is checked");
});

test("the ownership of a question is compared by its request id", () => {
	assert.equal(ownsQuestion({ requestId: "q-1" }, "q-1"), true);
	assert.equal(ownsQuestion({ requestId: "q-2" }, "q-1"), false);
	assert.equal(ownsQuestion(null, "q-1"), false);
	assert.equal(ownsQuestion(undefined, "q-1"), false);
	assert.equal(ownsQuestion({}, "q-1"), false);
});
