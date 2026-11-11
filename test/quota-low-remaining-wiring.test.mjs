/**
 * The alert of a low quota allowance.
 *
 * The alert is a fact about the allowance, not a decision and not a
 * failure. It is sent once per crossing, it needs no approval and it
 * costs no attempt of the recovery. The write of the mirror is the one
 * funnel, so every capture of the quota passes it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The source around a place, with a window before and after it. */
function around(needle, before = 0, after = 1200) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	return indexSource.slice(Math.max(0, at - before), at + after);
}

test("the write of the mirror is the funnel of the alert", () => {
	const region = around("function writeMirrorRecord(");
	assert.ok(region, "the write of the mirror is registered");
	assert.match(
		region,
		/notifyQuotaLowRemaining\(provider, record\);/,
		"every capture of the quota passes the alert",
	);
	assert.ok(
		region.indexOf("mirrorStore.writeProvider(") <
			region.indexOf("notifyQuotaLowRemaining("),
		"the alert sees the row that was written",
	);
});

test("the alert is sent once per crossing", () => {
	const region = around("function notifyQuotaLowRemaining(");
	assert.ok(region, "the alert is registered");
	assert.match(
		region,
		/quotaLowRemainingTracker\.observe\(\s*provider,\s*record\.h5_used_pct,?\s*\)/,
		"the tracker decides whether this is a crossing",
	);
	assert.match(
		region,
		/if \(decision !== "notify"\) return;/,
		"a state that did not change sends nothing",
	);
});

test("the alert states the remaining allowance, not the used one", () => {
	const region = around("function notifyQuotaLowRemaining(");
	assert.match(
		region,
		/remainingPctFromUsedPct\(record\.h5_used_pct as number\)/,
		"the percentage of the mirror is the used one",
	);
	assert.match(
		region,
		/remainingPct: Math\.round\(remainingPct \* 10\) \/ 10,/,
		"the alert states the remaining allowance",
	);
});

test("the alert goes out as its own event", () => {
	const region = around("function notifyQuotaLowRemaining(");
	assert.match(
		region,
		/nc\("QuotaLowRemaining", \{/,
		"the alert has an event of its own",
	);
	assert.match(
		region,
		/provider: label,/,
		"the alert names the provider",
	);
	assert.match(
		region,
		/quotaWindow: "5h",/,
		"the alert names the window",
	);
});

test("the alert costs no attempt of the recovery", () => {
	const region = around("function notifyQuotaLowRemaining(");
	for (const forbidden of [
		"noteFailure",
		"startRecovery",
		"scheduleAttempt",
		"noteSettled",
		"cancelPending",
	]) {
		assert.equal(
			region.includes(forbidden),
			false,
			`the alert does not touch the recovery: ${forbidden}`,
		);
	}
});

test("an alert that cannot be sent is not an alert that was sent", () => {
	const region = around("function notifyQuotaLowRemaining(");
	assert.match(
		region,
		/if \(!_nc\) return;/,
		"without a channel there is no alert",
	);
});
