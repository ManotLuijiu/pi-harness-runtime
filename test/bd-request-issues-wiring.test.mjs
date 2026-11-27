/**
 * The wiring of the reconciliation of the authorized issues.
 *
 * The reconciliation is only useful when it runs where the request starts
 * and where the request ends: the approval of a scope proposal authorizes
 * the issues of the request that starts there, the snapshot of the request
 * carries the outcome, and the request that ends forgets its issues.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The source around a place, with a window before and after it. */
function around(source, needle, before = 0, after = 1200) {
	const at = source.indexOf(needle);
	if (at === -1) return "";
	return source.slice(Math.max(0, at - before), at + after);
}

test("the approval of a scope proposal authorizes the issues of the request", () => {
	const region = around(indexSource, "dispatch: (proposal, ids) => {", 0, 2200);
	assert.ok(region, "the dispatch of the scope proposal is registered");
	assert.match(
		region,
		/requestIssues\.authorize\(requestScopeTracker\.generation, ids\)/,
		"the approved ids are the work of the request that starts there",
	);
	assert.match(
		region,
		/beginHumanRequest\(\);/,
		"the approval begins a new request before the ids are recorded",
	);
});

test("the snapshot of the request carries the reconciliation", () => {
	const region = around(indexSource, "async function readRequestWorkSnapshot(", 0, 3000);
	assert.ok(region, "the snapshot of the request work is read");
	assert.match(
		region,
		/requestIssues\.authorizedFor\(generation\)/,
		"the authorized issues of the request are read",
	);
	assert.match(
		region,
		/reconcileRequestIssues\(\{/,
		"the authorized issues are reconciled with the todos and the backlog",
	);
	assert.match(
		region,
		/bdDiscovery\.scan\(\)/,
		"the backlog is read through the bounded discovery",
	);
	assert.match(
		region,
		/authorizedOutstanding: reconciliation\.outstanding/,
		"the outstanding authorized issues are reported",
	);
});

test("the request that ends forgets its issues", () => {
	const region = around(indexSource, "cancel: (generation) => {", 0, 1800);
	assert.ok(region, "the cancellation of the request is registered");
	assert.match(
		region,
		/requestIssues\.forget\(generation\)/,
		"the issues of the request are its history",
	);
});
