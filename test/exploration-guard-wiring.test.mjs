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
