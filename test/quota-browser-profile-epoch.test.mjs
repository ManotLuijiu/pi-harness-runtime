/**
 * The reset of the quota in the browser profile of the user.
 *
 * The console of the provider writes the remaining time of a window as
 * text. The mirror needs an absolute moment, so the capture is the anchor
 * of that text. The path of the cookie keeps the epoch of the provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { resetEpochFromDuration } from "../harness/quota-reset-duration.ts";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "..", "index.ts"), "utf8");

/** The source around a place, with a window before and after it. */
function around(needle, before = 0, after = 1600) {
	const at = indexSource.indexOf(needle);
	if (at === -1) return "";
	return indexSource.slice(Math.max(0, at - before), at + after);
}

test("the browser profile anchors the reset of the text to the capture", () => {
	const region = around("const parsed = parseMiniMaxQuotaText(rawText);");
	assert.ok(region, "the browser profile parses the text of the console");
	assert.match(
		region,
		/const observedAt = Date\.parse\(status\.checked_at\);/,
		"the capture is the anchor of the text",
	);
	assert.match(
		region,
		/h5_resets_at_epoch: resetEpochFromDuration\(\s*parsed\.h5ResetsAt,\s*observedAt,?\s*\)/,
		"the five-hour window gets an absolute moment",
	);
	assert.match(
		region,
		/weekly_resets_at_epoch: resetEpochFromDuration\(\s*parsed\.weeklyResetsAt,\s*observedAt,?\s*\)/,
		"the weekly window gets an absolute moment",
	);
});

test("the path of the cookie keeps the epoch of the provider", () => {
	const region = around("const data = await quotaScraper.scrape();");
	assert.ok(region, "the path of the cookie is registered");
	assert.match(
		region,
		/h5_resets_at_epoch: data\.h5ResetsAtEpoch,/,
		"the five-hour window keeps the epoch of the provider",
	);
	assert.match(
		region,
		/weekly_resets_at_epoch: data\.weeklyResetsAtEpoch,/,
		"the weekly window keeps the epoch of the provider",
	);
});

test("the reset of the text becomes an absolute moment", () => {
	const capturedAt = Date.parse("2026-11-11T10:00:00.000Z");
	assert.equal(
		resetEpochFromDuration("1 hr 42 min", capturedAt),
		capturedAt + 102 * 60_000,
	);
	assert.equal(
		resetEpochFromDuration("4 days 20 hr 42 min", capturedAt),
		capturedAt + (4 * 24 + 20) * 60 * 60_000 + 42 * 60_000,
	);
});

test("a text without a duration gives no moment", () => {
	const capturedAt = Date.parse("2026-11-11T10:00:00.000Z");
	assert.equal(resetEpochFromDuration(undefined, capturedAt), undefined);
	assert.equal(resetEpochFromDuration("", capturedAt), undefined);
	assert.equal(resetEpochFromDuration("soon", capturedAt), undefined);
});
