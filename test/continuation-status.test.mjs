/**
 * The status of a continuation may only end when the turn settles.
 *
 * The test covers the gate that owns that state and the wiring in the
 * extension: a timer that cleared the status while the agent was still
 * working would claim that nothing runs any more.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ContinuationGate } from "../packages/jev-judge/dist/continuation-status.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

test("the continuation gate stays pending until the turn settles", () => {
	const gate = new ContinuationGate();
	assert.equal(gate.pending, false);
	gate.begin();
	assert.equal(gate.pending, true);
	assert.equal(gate.settle(), true);
	assert.equal(gate.pending, false);
});

test("the continuation gate clears the status only once", () => {
	const gate = new ContinuationGate();
	gate.begin();
	assert.equal(gate.settle(), true);
	assert.equal(gate.settle(), false);
});

test("the status is not cleared with a timer", () => {
	const source = readFileSync(join(root, "index.ts"), "utf8");
	assert.equal(
		/setTimeout\(\s*\(\)\s*=>\s*updateAutoContinueStatus\("IDLE"\)/.test(source),
		false,
	);
	assert.equal(
		/setTimeout\([^)]*updateAutoContinueStatus\("IDLE"\)/.test(source),
		false,
	);
});

test("the gate starts with the continuation and settles with the agent", () => {
	const source = readFileSync(join(root, "index.ts"), "utf8");
	assert.ok(source.includes("_continuation.begin()"));
	const settled = source.indexOf('pi.on("agent_settled"');
	assert.ok(settled > -1);
	assert.ok(source.indexOf("_continuation.settle()", settled) > settled);
});
