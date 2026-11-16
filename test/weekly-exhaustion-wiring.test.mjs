/**
 * The wiring of the empty weekly allowance and of the compaction that
 * fails with an overload.
 *
 * The behaviour of the pieces is tested in their own suites: the
 * selector of the empty week, the registry of the decision, the runtime of
 * the recovery and the notification of the event. This suite checks that
 * the harness wires them to each other the way the contract asks:
 *
 * - the empty week is asked before the ordinary reset schedules itself,
 * - the decision belongs to the human alone: the judge is never asked,
 * - a write that knows no window keeps the evidence of the windows,
 * - a compaction that fails with an overload shares the executor of the
 *   overload, so there is one countdown and one resume.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const runtimeSource = readFileSync(
	new URL("../harness/provider-recovery-runtime.ts", import.meta.url),
	"utf8",
);
const weeklySource = readFileSync(
	new URL("../harness/weekly-quota-exhaustion.ts", import.meta.url),
	"utf8",
);
const registrySource = readFileSync(
	new URL("../harness/weekly-exhaustion-registry.ts", import.meta.url),
	"utf8",
);
const mergeSource = readFileSync(
	new URL("../harness/mirror-record-merge.ts", import.meta.url),
	"utf8",
);
const proactiveCompactSource = readFileSync(
	new URL("../proactive-compact.ts", import.meta.url),
	"utf8",
);
const policySource = readFileSync(
	new URL("../packages/notification/src/notification-policy.ts", import.meta.url),
	"utf8",
);

test("the empty week is asked before the ordinary reset", () => {
	const weekly = runtimeSource.indexOf("blockOnWeeklyExhaustion(candidate, sessionId)");
	const ordinary = runtimeSource.indexOf("scheduleQuotaReset(candidate, sessionId)");
	assert.ok(weekly !== -1, "the runtime knows the empty week");
	assert.ok(ordinary !== -1, "the runtime knows the ordinary reset");
	assert.ok(
		weekly < ordinary,
		"the empty week is checked first: the ordinary reset would continue the work on its own",
	);
});

test("the decision about the empty week belongs to the human alone", () => {
	assert.match(
		registrySource,
		/export type WeeklyDecision = "countdown" \| "manual";/,
		"the registry knows the two choices of the human",
	);
	assert.doesNotMatch(
		registrySource,
		/evaluatePendingQuestion|applyDecisionPolicy|judge\(/,
		"the judge is never asked about an empty week",
	);
	assert.match(
		indexSource,
		/resolveWeeklyDecision\(/,
		"the decision of every channel reaches one resolver",
	);
	assert.doesNotMatch(
		indexSource,
		/evaluatePendingQuestion\([^)]*weekly/i,
		"the empty week never reaches the judge",
	);
});

test("the postback of LINE carries the request ID of the decision", () => {
	assert.match(
		indexSource,
		/callback\.action\.indexOf\("_"\)/,
		"the postback that arrives as one string is split at the underscore",
	);
	assert.match(
		indexSource,
		/separator === -1\s*\?\s*callback\.targetId/,
		"the postback that arrives split keeps the request ID",
	);
});

test("only the count down schedules anything", () => {
	assert.match(
		indexSource,
		/if \(decision === "countdown"\) \{/,
		"only the count down schedules a resume",
	);
	assert.match(
		indexSource,
		/scheduleWeeklyReset\(/,
		"the count down waits for the reset of the week",
	);
});

test("the canonical id of the decision holds no underscore", () => {
	assert.match(
		registrySource,
		/return `week-\$\{provider\.toLowerCase\(\)\}-\$\{hex\}`;/,
		"the id of the decision is one token for the callback data",
	);
});

test("the message of the empty week travels in full", () => {
	assert.match(
		weeklySource,
		/weekly quota exhausted\. Resets in \$\{formatResetDuration/,
		"the message names the time that is left and the state of the work",
	);
});

test("a write that knows no window keeps the evidence of the windows", () => {
	assert.match(
		indexSource,
		/mergeMirrorRecord\(/,
		"the mirror write merges the row instead of replacing it",
	);
	assert.match(
		mergeSource,
		/weekly_used_pct/,
		"the evidence of the week survives a reduced write",
	);
});

test("the empty week needs no approval", () => {
	assert.doesNotMatch(
		policySource,
		/"QuotaWeeklyExhausted"/,
		"the event is not an approval: the human decides with its own buttons",
	);
});

test("a compaction that fails with an overload shares the executor of the overload", () => {
	assert.match(
		indexSource,
		/"session_compact_failed"/,
		"the failure of the compaction is observed",
	);
	assert.match(
		indexSource,
		/isProviderOverloadText\(errorMessage\)/,
		"the text of the failure decides whether it is an overload",
	);
	assert.match(
		indexSource,
		/providerRecoveryRuntime\?\.scheduleOverloadResume\(\)/,
		"the compaction goes through the executor of the overload",
	);
	assert.match(
		proactiveCompactSource,
		/export function isProviderOverloadText/,
		"the text of an overload is a fact of its own",
	);
});

test("the executor of the overload owns one timer and one budget", () => {
	assert.match(
		runtimeSource,
		/this\.overloadTimer = this\.setTimer\(/,
		"the executor owns the timer of the overload",
	);
	assert.match(
		runtimeSource,
		/this\.overloadAttempts \+= 1;/,
		"the executor owns the budget of the overload",
	);
	assert.match(
		runtimeSource,
		/scheduleOverloadResume\(\): boolean \{/,
		"the compaction reaches the same executor",
	);
});

test("the abort of the user is not an overload", () => {
	assert.match(
		indexSource,
		/if \(event\.aborted\) \{/,
		"an aborted compaction is a decision of the user",
	);
});

test("a turn that Pi retries itself is not continued twice", () => {
	assert.match(
		indexSource,
		/if \(event\.willRetry\) \{/,
		"the retry of Pi owns the turn: a resume would continue the work twice",
	);
});
