/**
 * The wiring of the guard of the exploration.
 *
 * The behaviour of the pieces is tested in their own suites: the
 * observation of the tools, the state of the request, the budget and the
 * decision of the guard, the checkpoint and the status.
 *
 * This suite checks that the harness wires them the way the contract of the
 * handoff asks:
 *
 * - the tools of the agent are observed, and the observation happens when
 *   the result is known,
 * - the checkpoint of the exploration is saved before a compaction and
 *   rides along with the continuation after it,
 * - the intervention of the guard is delivered at the boundary of the turn,
 *   once, and it authorises nothing,
 * - a finished request makes the pending actions of the guard inert,
 * - the status of the exploration is passive: it never steers the session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const runtimeSource = readFileSync(
	new URL("../harness/exploration-guard-runtime.ts", import.meta.url),
	"utf8",
);
const budgetSource = readFileSync(
	new URL("../packages/exploration-guard/src/budget.ts", import.meta.url),
	"utf8",
);
const checkpointSource = readFileSync(
	new URL("../packages/exploration-guard/src/checkpoint.ts", import.meta.url),
	"utf8",
);
const stateSource = readFileSync(
	new URL("../packages/exploration-guard/src/state.ts", import.meta.url),
	"utf8",
);
const observationSource = readFileSync(
	new URL("../packages/exploration-guard/src/observation.ts", import.meta.url),
	"utf8",
);
const toolSource = readFileSync(
	new URL("../harness/exploration-checkpoint-tool.ts", import.meta.url),
	"utf8",
);
const controllerSource = readFileSync(
	new URL("../packages/jev-judge/src/continuation-controller.ts", import.meta.url),
	"utf8",
);

test("the harness observes the tools of the agent", () => {
	assert.ok(indexSource.includes('pi.on("tool_call"'));
	assert.ok(indexSource.includes('pi.on("tool_execution_end"'));
	assert.ok(indexSource.includes("explorationGuard?.toolCall("));
	assert.ok(indexSource.includes("explorationGuard?.toolCallEnd("));
});

test("the observation happens when the result is known", () => {
	// The call is remembered when it begins, and the observation happens
	// when it ends: a failed read read nothing.
	const callIndex = runtimeSource.indexOf("toolCall(toolCallId: string");
	const endIndex = runtimeSource.indexOf("toolCallEnd(");
	assert.ok(callIndex >= 0, "the runtime remembers the call");
	assert.ok(endIndex > callIndex, "the observation follows the call");
});

test("the checkpoint is saved before the compaction", () => {
	const compactIndex = indexSource.indexOf('pi.on("session_compact"');
	const saveIndex = indexSource.indexOf("explorationGuard?.saveCheckpoint()");
	assert.ok(compactIndex >= 0, "the compaction is handled");
	assert.ok(saveIndex > compactIndex, "the checkpoint is saved in the compaction");
});

test("the continuation after the compaction names the checkpoint", () => {
	assert.ok(indexSource.includes("continuationAfterCompaction()"));
	assert.ok(indexSource.includes("explorationContinuation"));
});

test("the intervention is delivered at the boundary of the turn", () => {
	const turnEndIndex = indexSource.indexOf('pi.on("turn_end"');
	const deliverIndex = indexSource.indexOf("deliverExplorationIntervention()");
	assert.ok(turnEndIndex >= 0, "the end of the turn is handled");
	assert.ok(
		deliverIndex > turnEndIndex,
		"the intervention is delivered after the turn",
	);
	assert.ok(indexSource.includes("takePending()"));
});

test("the agent can record the checkpoint of the request", () => {
	assert.ok(indexSource.includes("registerExplorationCheckpointTool(pi"));
	assert.ok(indexSource.includes("current: () => explorationGuard"));
});

test("the checkpoint tool records evidence and authorises nothing", () => {
	assert.ok(toolSource.includes("recordCheckpoint("));
	assert.ok(toolSource.includes("EXPLORATION_CHECKPOINT_TOOL"));
	assert.ok(!toolSource.includes("git commit"));
	assert.ok(!toolSource.includes("npm publish"));
	assert.ok(!toolSource.includes("bd close"));
});

test("the reminder goes through the guarded continuation path", () => {
	// The delivery of the reminder is a guarded dispatch, not a raw send.
	assert.ok(indexSource.includes("controller.dispatchAdvisory(pending.message"));
	// The send of the advisory lives in the advisory hook, so it only
	// happens after the guards of the continuation passed.
	assert.ok(indexSource.includes("advisoryDispatch: async (content: string, meta) =>"));
	assert.ok(indexSource.includes('"harness:exploration-guard"'));
	// The controller knows the guarded path for an advisory.
	assert.ok(controllerSource.includes("async dispatchAdvisory("));
	assert.ok(controllerSource.includes("this.guardedDispatch("));
});

test("the guarded advisory never forces a turn on its own", () => {
	// The advisory is dispatched by the controller, which stops it when the
	// work is paused, when the session is busy and when the task is done.
	const advisory = controllerSource.slice(
		controllerSource.indexOf("async dispatchAdvisory("),
		controllerSource.indexOf("async dispatchAdvisory(") + 2000,
	);
	assert.ok(advisory.includes("itemId?: number"));
	assert.ok(advisory.includes("guardedDispatch"));
	// The advisory does not consume the attempt budget of a task.
	assert.ok(!advisory.includes("recordAttempt("));
});

test("the intervention authorises nothing", () => {
	const start = indexSource.indexOf("async function deliverExplorationIntervention");
	const block = indexSource.slice(start, start + 2000);
	assert.ok(!block.includes("git commit"));
	assert.ok(!block.includes("npm publish"));
	assert.ok(!block.includes("bd close"));
});

test("a finished request makes the pending actions inert", () => {
	assert.ok(indexSource.includes("explorationGuard?.deactivate()"));
	assert.ok(indexSource.includes("explorationGuard?.activate()"));
});

test("the status of the exploration is passive", () => {
	assert.ok(indexSource.includes("setExplorationStatus"));
	assert.ok(indexSource.includes('setStatus("harness-exploration"'));
});

test("the guard speaks a bounded number of times", () => {
	assert.ok(runtimeSource.includes("MAX_SPEECHES_PER_REQUEST"));
	assert.ok(runtimeSource.includes("speechCount"));
});

test("the continuation of the guard never authorises a commit or a build", () => {
	const text = checkpointSource.match(/EXPLORATION_CONTINUATION_TEXT[\s\S]*?;/);
	assert.ok(text, "the continuation text exists");
	const value = text[0];
	assert.ok(!value.includes("commit"));
	assert.ok(!value.includes("push"));
	assert.ok(!value.includes("npm run build"));
});

test("the state of the request holds no content and no credential", () => {
	assert.ok(stateSource.includes("sanitizeText"));
	assert.ok(stateSource.includes("sanitizePath"));
	assert.ok(stateSource.includes("<redacted>"));
});

test("an unknown shell command says nothing about the coverage", () => {
	assert.ok(observationSource.includes('source: "unknown"'));
	assert.ok(observationSource.includes("classifyShellCommand"));
});

test("the budget never blocks the access to the source", () => {
	assert.ok(!budgetSource.includes("throw new Error"));
	assert.ok(budgetSource.includes("DEFAULT_EXPLORATION_BUDGET"));
});
