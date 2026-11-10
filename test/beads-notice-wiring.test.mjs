/**
 * The notice about the issue tracker of the session.
 *
 * The harness keeps its issues with bd (beads): the loop of the session
 * closes an issue with it, and the checklist before a commit asks for the
 * open ones. A user without bd gets a session where a part of the harness
 * is silently missing.
 *
 * This suite checks the wiring: the notice is reported when the extension
 * loads, the report names the tracker, and the tracker is looked up on the
 * path of the environment instead of being assumed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const reportSource = readFileSync(
	new URL("../harness/startup-report.ts", import.meta.url),
	"utf8",
);

test("the startup reports the tracker", () => {
	assert.match(
		indexSource,
		/reportBeadsTracker\(\)/,
		"the startup reports the issue tracker of the session",
	);
});

test("the tracker is looked up on the path of the environment", () => {
	assert.match(
		indexSource,
		/findOnPath\("bd"/,
		"the notice is based on the path of the environment, not on an assumption",
	);
});

test("the notice carries the report of the startup", () => {
	assert.match(
		indexSource,
		/const report = beadsReport\(\{ available: Boolean\(path\), version \}\);/,
		"the notice is built by the report of the startup",
	);
	assert.match(
		indexSource,
		/addHarnessMessage\(report\.label, report\.text, report\.status, report\.details\);/,
		"the notice is shown with its details",
	);
});

test("the report names the tracker and the way to install it", () => {
	assert.match(reportSource, /export function beadsReport\(/);
	assert.match(reportSource, /label: "Beads"/);
	assert.match(reportSource, /npm install -g @beads\/bd/);
});
