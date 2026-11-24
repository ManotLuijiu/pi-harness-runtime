/**
 * The wiring of the guard of a repeated output in the harness.
 *
 * The detector, the guard, the runtime and the gate of the recovery have
 * their own suite. This one protects the four seams that put them into the
 * lifecycle of the session:
 *
 * - the stream of the answer is observed, and the run is stopped only
 *   after the guard was marked,
 * - the tail of the noise is kept out of the context of the next call of
 *   the model, and the transcript of the session keeps it,
 * - the recovery is decided at the boundary of the run, and it happens
 *   once,
 * - the stop of the guard is never the stop of the human.
 *
 * The tests read the source of the harness: no program of the machine is
 * called, no model is asked anything.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/**
 * The body of a callback: from its head to its closing brace.
 *
 * A window of characters breaks when the body grows: the line the check
 * is about leaves the window and the check fails for a reason that has
 * nothing to do with the behaviour. The body of the callback ends where
 * the callback ends.
 */
function callbackBody(needle) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	const lineStart = indexSource.lastIndexOf("\n", at) + 1;
	const indent = /^\t*/.exec(indexSource.slice(lineStart))[0].length;
	const lines = indexSource.slice(at).split("\n");
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		const lineIndent = /^\t*/.exec(line)[0].length;
		if (lineIndent === indent && line.trim() === "},") {
			return lines.slice(0, i + 1).join("\n");
		}
	}
	return lines.join("\n");
}

test("the stream of the answer is observed and the run is stopped after the mark", () => {
	const body = callbackBody('pi.on("message_update"');
	assert.ok(body, "the harness does not observe the stream of the answer");
	// Only the text of the answer is observed: the thinking and the
	// arguments of a tool call are not the output that repeats itself.
	assert.match(body, /textDeltaOf\(event\.assistantMessageEvent\)/);
	// The run is stopped inside the callback of the runtime, and the
	// runtime marks the guard before it calls it.
	assert.match(body, /observeDelta\(delta, \(\) => \{/);
	assert.match(body, /ctx\.abort\(\)/);
	// The order matters: the abort is inside the callback of the runtime,
	// and the runtime marks the guard before it calls that callback.
	const runtime = readFileSync(
		new URL("../harness/repetition-guard-runtime.ts", import.meta.url),
		"utf8",
	);
	const mark = runtime.indexOf("this.guard.mark(");
	const stopped = runtime.indexOf("this.stopped = true;");
	const interrupt = runtime.indexOf("interrupt(state)");
	assert.ok(mark !== -1 && stopped !== -1 && interrupt !== -1);
	assert.ok(
		mark < stopped && stopped < interrupt,
		"the guard has to be marked, and the stop recorded, before the run is stopped",
	);
});

test("the tail of the noise is kept out of the context of the model", () => {
	const body = callbackBody('pi.on("context"');
	assert.ok(body, "the harness does not touch the context of the model");
	// The messages the handler returns are the quarantined ones.
	assert.match(body, /repetitionGuard\.quarantine\(/);
	// The transcript of the session is not touched: the handler replaces
	// the messages it returns and nothing else.
	assert.ok(
		!/event\.messages\s*=\s*/.test(body),
		"the handler must not write into the messages of the event",
	);
});

test("the recovery is decided at the boundary of the run and it happens once", () => {
	const body = callbackBody(
		'pi.on("agent_settled", async () => {\n\t\t// The live repetition is consumed',
	);
	assert.ok(body, "the harness does not decide the recovery of a repetition");
	assert.match(body, /decideRepetitionRecovery\(/);
	// The facts of the session are the ones of the gate: the request that
	// repeated itself, the work, the pause, the question and the budget.
	assert.match(body, /requestMatches:/);
	assert.match(body, /work: await currentRequestWorkState\(\)/);
	assert.match(body, /paused: /);
	assert.match(body, /questionOpen: /);
	assert.match(body, /budgetSpent: await repetitionBudgetSpent\(\)/);
	// The claim of the recovery is taken before the work starts again.
	assert.match(body, /claimRecovery\(\)/);
	// The recovery waits for the boundary of the run: it is a resume of the
	// turn that was cut off.
	assert.match(body, /queueAutoResume\(\s*"repetition-guard"/);
	// The recovery continues the request that repeated itself. The guard of
	// a stale resume reads that scope and neutralizes the recovery when the
	// human replaced the request in the meantime.
	assert.match(body, /scope: "request"/);
	// The row of the guard leaves on both paths: the promise of one
	// recovery is kept or the work is blocked, and the row never stays
	// with a promise that the session does not keep.
	const removes = body.match(/pendingActions\.remove\(/g) ?? [];
	assert.ok(
		removes.length >= 2,
		"the row of the guard must leave on the path of the recovery as well",
	);
});

test("the stop of the guard is never the stop of the human", () => {
	const body = callbackBody('pi.on("message_end", async (event, ctx) => {');
	assert.ok(body, "the harness does not look at the end of the message");
	// The stop is classified with the state of the guard, not with the
	// signal alone.
	assert.match(body, /classifyRunStop\(\{/);
	// The fact is taken by the boundary of the run: the next run of the
	// model does not inherit the stop of the guard.
	assert.match(body, /stoppedByGuard: repetitionGuard\.takeStoppedByGuard\(\)/);
	// The two stops are two different branches.
	assert.match(body, /if \(stop === "guard"\)/);
	assert.match(body, /if \(stop === "human"\)/);
	// The recovery of the provider does not start for a run that the guard
	// stopped: the provider is not at fault.
	const guard = body.slice(body.indexOf('if (stop === "guard")'));
	const human = body.indexOf('if (stop === "human")');
	assert.ok(guard.length > 0 && human > 0);
	assert.match(
		guard.slice(0, human),
		/providerRecoveryRuntime\?\.cancel\(\)/,
		"the recovery of the provider must not fight the guard",
	);
});

test("the facts of the gate are read from the controllers that have them", () => {
	const body = callbackBody(
		'pi.on("agent_settled", async () => {\n\t\t// The live repetition is consumed',
	);
	assert.ok(body, "the harness does not decide the recovery of a repetition");
	// The pause of the human belongs to the controller of the todos. The
	// controller of the questions of the notification has no such method,
	// and the call would throw before the decision is made.
	assert.match(body, /paused: todoContinuationHandle\?\.isExplicitlyPaused\(\)/);
	assert.doesNotMatch(
		body,
		/pqController\?\.isExplicitlyPaused/,
		"the controller of the questions does not know the pause",
	);
	// The question of the human belongs to the controller of the questions.
	assert.match(body, /pqController\?\.getCurrentQuestion/);
});

test("the budget of the work is read from the controller of the todos", () => {
	// The budget is a fact of the continuation of the todos: the
	// controller of the questions of the notification does not know it, and
	// the budget of the work would never be read.
	const budget = indexSource.slice(
		indexSource.indexOf("async function repetitionBudgetSpent()"),
		indexSource.indexOf("async function repetitionBudgetSpent()") + 900,
	);
	assert.ok(budget, "the harness does not read the budget of the work");
	assert.match(budget, /sharedState\.todoContinuationController/);
	assert.doesNotMatch(
		budget,
		/pqController as \{/,
		"the controller of the questions does not know the budget",
	);
});

test("the guard belongs to the session and to the request", () => {
	// A new session starts with a clean guard.
	const session = callbackBody(
		'pi.on("session_start", () => {\n\t\ttaskTracking.reset();',
	);
	assert.ok(session, "the harness does not watch the start of the session");
	assert.match(session, /repetitionGuard\.reset\(\)/);
	// A new request of the human is a new run.
	assert.match(indexSource, /repetitionGuard\.reset\(\)/);
});
