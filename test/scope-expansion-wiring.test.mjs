/**
 * The wiring of the scope expansion.
 *
 * The backlog of the session is not work of the request that finished. The
 * wiring has to say three things: the exact ids are read from the tracker,
 * the decision of the human reaches the proposal, and the work starts only
 * after the decision was delivered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The source around a place, with a window before and after it. */
function around(needle, before = 0, after = 1600) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	return indexSource.slice(Math.max(0, at - before), at + after);
}

test("the task context keeps the exact ids of the backlog", () => {
	const region = around("async function getTaskContext()", 0, 2600);
	assert.ok(region, "the task context is read");
	assert.match(region, /id\?: string;/, "the id of an issue is read");
	assert.match(
		region,
		/issues\.push\(\{ id: task\.id, title: task\.title, status: task\.status \}\)/,
		"the exact id is kept with the title",
	);
});

test("the completion of a request proposes the backlog", () => {
	const region = around("async function proposeScopeExpansion(", 0, 2200);
	assert.ok(region, "the proposal of the backlog exists");
	assert.match(
		region,
		/if \(runtime\.open\.length > 0\) return;/,
		"one proposal waits for an answer",
	);
	assert.match(
		region,
		/context\.issues\s*\.slice\(0, MAX_SCOPE_CANDIDATES\)/,
		"the candidates are bounded",
	);
	assert.match(
		region,
		/\{ id: issue\.id, title: issue\.title \}/,
		"the candidate names the exact id",
	);
	assert.match(region, /runtime\.propose\(\{/, "the proposal is created");
});

test("the completion of the request triggers the proposal", () => {
	const region = around('await proposeScopeExpansion();', 900, 200);
	assert.ok(region, "the completion triggers the proposal");
	assert.match(region, /ReadyForClient/, "the completion is reported first");
});

test("the answer of a channel reaches the proposal", () => {
	const region = around("function applyChannelApproval(", 0, 3200);
	assert.ok(region, "the channel approval is applied");
	assert.match(
		region,
		/scopeRuntime\?\.proposalForQuestion\(requestId\)/,
		"the question of a proposal is recognized",
	);
	assert.match(
		region,
		/answerByQuestion\(requestId, outcome,/,
		"the answer reaches the proposal",
	);
});

test("the proposal is delivered with the canonical question id", () => {
	const region = around("function createScopeExpansionRuntime(", 0, 5200);
	assert.ok(region, "the runtime is created");
	assert.match(
		region,
		/notifyWithApproval\(\s*"ScopeProposal"/,
		"the proposal is an approval notification",
	);
	assert.match(region, /questionId: meta\.questionId,/, "the canonical id is carried");
	assert.match(
		region,
		/scopeIds: proposal\?\.proposedIds,/,
		"the exact ids travel with the proposal",
	);
});

test("the decision is delivered before the work starts", () => {
	const region = around("function createScopeExpansionRuntime(", 0, 9000);
	assert.ok(region, "the runtime is created");
	const deliverAt = region.indexOf('notify("ScopeDecision"');
	const dispatchAt = region.indexOf("dispatch: (proposal, ids) =>");
	assert.ok(deliverAt > -1, "the decision is notified");
	assert.ok(dispatchAt > -1, "the work starts");
});

test("the dispatch names the exact ids", () => {
	const region = around("dispatch: (proposal, ids) => {", 0, 1400);
	assert.ok(region, "the dispatch exists");
	assert.match(region, /ids\.map\(\(id\) => `- \$\{id\}`\)/, "the exact ids are named");
	assert.match(region, /beginHumanRequest\(\);/, "the approved work begins a new scope");
});

test("the runtime belongs to the session", () => {
	const region = around('pi.on("session_start", async (_event, ctx) => {', 0, 900);
	assert.ok(region, "the session starts the runtime");
	assert.match(region, /sharedState\.scopeRuntime = createScopeExpansionRuntime\(\);/);
	assert.match(region, /sharedState\.scopeRuntime\?\.dispose\(\);/);
});

test("the group of the approved work is checked when the session settles", () => {
	const region = around("await sharedState.scopeRuntime?.checkGroupFinished();", 400, 200);
	assert.ok(region, "the group is checked");
	assert.match(region, /reconcileObsoleteQuestion\(\)/, "the check runs in the settled handler");
});
