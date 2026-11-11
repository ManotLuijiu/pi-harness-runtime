/**
 * The scope of an automatic resume.
 *
 * An automatic resume continues the request that is running. It is not an
 * instruction to find more work: a queued `resume` that is consumed after
 * the request finished would send the agent to the backlog, and the
 * backlog is not work of this request.
 *
 * The mechanical question - does authorized work remain? - belongs in code.
 * These tests cover the decision of the guard and the wiring that keeps the
 * backlog out of the request.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	decideResumeScope,
	RESUME_SCOPE_RULE,
} from "../harness/resume-scope.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

test("a resume of a request with work goes on", () => {
	const decision = decideResumeScope({ work: "unfinished", reason: "post-compact" });
	assert.equal(decision.action, "continue");
});

test("a resume of a completed request is suppressed", () => {
	const decision = decideResumeScope({ work: "complete", reason: "post-compact" });
	assert.equal(decision.action, "suppress");
	assert.match(decision.report, /complete/);
	assert.match(decision.report, /post-compact/, "the report names the reason");
});

test("an unknown state is not a completion", () => {
	// Stopping work that is unfinished is worse than asking again, so the
	// uncertainty is preserved and the resume goes on.
	const decision = decideResumeScope({ work: "unknown", reason: "post-compact" });
	assert.equal(decision.action, "continue");
	assert.match(decision.reason, /unknown/);
});

test("the rule tells the agent that the backlog is not the next task", () => {
	assert.match(RESUME_SCOPE_RULE, /continues only the current authorized request/);
	assert.match(RESUME_SCOPE_RULE, /remain stopped/);
	assert.match(RESUME_SCOPE_RULE, /backlog are not pending work/);
	assert.match(RESUME_SCOPE_RULE, /do not create executable todos/);
});

test("the guard runs where the automatic resume is queued", () => {
	assert.match(
		indexSource,
		/decideResumeScope\(\{\s*work: await currentRequestWorkState\(\)/,
		"the queue of the resume is gated by the guard",
	);
	assert.match(
		indexSource,
		/if \(decision\.action === "suppress"\)/,
		"a suppressed resume returns without sending the message",
	);
});

test("a cut turn is resumed without the guard", () => {
	// The output limit cuts a turn off: that turn is unfinished by
	// definition, whatever the todo list says.
	assert.match(indexSource, /scope: "turn"/);
	assert.match(indexSource, /options\.scope !== "turn"/);
});

test("the state of the work is read from the shared state of the session", () => {
	assert.match(indexSource, /sharedState\.workContext = currentWorkContext;/);
	assert.match(
		indexSource,
		/if \(typeof accessor !== "function"\) return "unknown";/,
		"without the state the uncertainty is preserved",
	);
});

test("the completion is reported once per request", () => {
	assert.match(indexSource, /let suppressedResumeReported = false;/);
	assert.match(indexSource, /if \(!report \|\| suppressedResumeReported\) return;/);
	assert.match(
		indexSource,
		/suppressedResumeReported = false;/,
		"a new request of the human gets its own report",
	);
});

test("the bd hint is bookkeeping and not an authorization", () => {
	assert.match(indexSource, /a pending\s*\n?\s*bd issue is not authorized work of the current request/);
});
