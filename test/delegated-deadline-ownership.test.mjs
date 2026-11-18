/**
 * The deadline of a delegated question belongs to the delegation.
 *
 * The deadline of a question is not an answer. When the user delegated
 * the outcome in advance, the delegation decides at the deadline and the
 * judge is never asked about a question that already has its answer.
 *
 * The wiring is read from the source of the extension: the branch of the
 * deadline has to expire the delegation and return before the judge is
 * consulted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The source around a place, with a window before and after it. */
function around(needle, before = 0, after = 2600) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	return indexSource.slice(Math.max(0, at - before), at + after);
}

test("the deadline of a delegated question expires the delegation", () => {
	const region = around("onDeadline: (requestId: string) => {");
	assert.ok(region, "the deadline of a question exists");
	assert.match(
		region,
		/const delegated = sharedState\.delegatedApproval\?\.get\(requestId\);/,
		"the delegation of the question is read",
	);
	assert.match(
		region,
		/if \(delegated && delegated\.state === "pending"\) \{/,
		"a pending delegation owns the deadline",
	);
	assert.match(
		region,
		/sharedState\.delegatedApproval\?\.expire\(requestId\);/,
		"the delegation decides at the deadline",
	);
});

test("the delegation decides before the judge is asked", () => {
	const region = around("onDeadline: (requestId: string) => {");
	// The branch of the delegation ends right after the expiry: the judge
	// is not consulted for a question that has its answer.
	assert.match(
		region,
		/expire\(requestId\);\s*return;/,
		"the deadline returns after the delegation decided",
	);
	// The judge is asked only for a question that has no delegation.
	assert.match(
		region,
		/checkAndAutoContinue\("countdown"\)/,
		"the judge is asked for the questions that have no delegation",
	);
});

test("the judge is never asked about a delegated question that was decided", () => {
	const region = around("onDeadline: (requestId: string) => {");
	assert.match(
		region,
		/if \(delegated\.state === "claimed" \|\| delegated\.state === "answered"\) \{\s*return;/,
		"a decided delegation ends the deadline without the judge",
	);
});

test("the answer of the human reaches the delegation before the judge", () => {
	const region = around("sharedState.delegatedApproval?.answer(", 120);
	assert.ok(region, "the answer of the human reaches the delegation");
	assert.match(
		region,
		/const decided = sharedState\.delegatedApproval\?\.answer\(/,
		"the delegation is asked first",
	);
});
