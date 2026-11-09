/**
 * The wiring of the bounded recovery in the runtime.
 *
 * The policy of the recovery (the quadratic waits, the budget of four
 * attempts, the lower bounds) lives in `harness/provider-recovery.ts` and is
 * tested there with an injected clock. This suite checks the wiring: the
 * runtime classifies the failure, hands it to the cycle, and the cycle uses
 * the existing auto-resume executor instead of a second resume loop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const proactiveCompactSource = readFileSync(
	new URL("../proactive-compact.ts", import.meta.url),
	"utf8",
);

test("the runtime classifies the failure of a turn", () => {
	assert.match(
		indexSource,
		/classifyProviderFailure\(/,
		"the runtime classifies the provider failure",
	);
	assert.match(
		indexSource,
		/providerFailure\.recovery === "bounded-recovery"/,
		"the bounded recovery is entered by the classification, not by a guess",
	);
});

test("the recovery reuses the existing auto-resume executor", () => {
	assert.match(
		indexSource,
		/queueAutoResume\(\s*"provider-recovery",\s*PROVIDER_OVERLOAD_RESUME_PROMPT/,
		"the recovery sends the established resume message through the established executor",
	);
	assert.match(
		proactiveCompactSource,
		/const PROVIDER_OVERLOAD_RESUME_PROMPT = "resume"/,
		"the message is the established one",
	);
});

test("the pending action shows the deadline the timer uses", () => {
	assert.match(
		indexSource,
		/id: PROVIDER_RECOVERY_ACTION_ID,[\s\S]{0,400}?dueAt,/,
		"the pending action carries the absolute deadline",
	);
	assert.match(
		indexSource,
		/const delayMs = Math\.max\(0, dueAt - Date\.now\(\)\);/,
		"the timer waits exactly until that deadline",
	);
});

test("a successful turn resets the cycle", () => {
	assert.match(
		indexSource,
		/providerRecovery\.noteSuccess\(\{/,
		"a successful turn ends the cycle",
	);
	assert.match(
		indexSource,
		/providerRecovery\.clear\(\)/,
		"the session shutdown ends the cycles",
	);
});

test("the cycle and the successful turn name the provider the same way", () => {
	assert.match(
		indexSource,
		/provider: provider\.toLowerCase\(\)/,
		"the cycle is keyed by the id of the provider",
	);
	assert.match(
		indexSource,
		/provider: m\.provider\.toLowerCase\(\)/,
		"a successful turn ends the cycle of the same provider",
	);
});

test("the exhausted budget is visible as a blocked action", () => {
	assert.match(
		indexSource,
		/state: "blocked",[\s\S]{0,400}?recovery attempts exhausted/,
		"the blocked row names the exhausted budget",
	);
});

test("the countdown of the recovery is removed when the attempt runs", () => {
	assert.match(
		indexSource,
		/providerRecoveryTimer = setTimeout\(\(\) => \{[\s\S]{0,300}?pendingActions\.remove\(PROVIDER_RECOVERY_ACTION_ID\)/,
		"a fired attempt leaves the countdown",
	);
});
