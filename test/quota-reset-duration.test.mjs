import { test } from "node:test";
import assert from "node:assert/strict";
import {
	parseResetDurationMs,
	resetEpochFromDuration,
} from "../harness/quota-reset-duration.ts";

const now = 1_700_000_000_000;
const minute = 60_000;

test("the duration of a reset is read from the text of the console", () => {
	assert.equal(parseResetDurationMs("1 hr 42 min"), 102 * minute);
	assert.equal(parseResetDurationMs("2 hr"), 120 * minute);
	assert.equal(parseResetDurationMs("45 min"), 45 * minute);
	assert.equal(parseResetDurationMs("30 seconds"), 30_000);
	assert.equal(parseResetDurationMs("4 days 20 hr 42 min"), 4 * 86_400_000 + 20 * 3_600_000 + 42 * minute);
});

test("a prefix does not change the duration", () => {
	assert.equal(parseResetDurationMs("Resets in 1 hr 42 min"), 102 * minute);
	assert.equal(parseResetDurationMs("  1 hr 42 min  "), 102 * minute);
});

test("a text without a duration proves nothing", () => {
	assert.equal(parseResetDurationMs("No credits yet"), undefined);
	assert.equal(parseResetDurationMs("2026-11-12 10:00"), undefined);
	assert.equal(parseResetDurationMs(""), undefined);
	assert.equal(parseResetDurationMs(undefined), undefined);
	assert.equal(parseResetDurationMs(null), undefined);
});

test("the epoch of a reset is anchored at the moment of the capture", () => {
	assert.equal(resetEpochFromDuration("1 hr 42 min", now), now + 102 * minute);
	assert.equal(resetEpochFromDuration("Resets in 45 min", now), now + 45 * minute);
});

test("a capture without a moment yields no epoch", () => {
	assert.equal(resetEpochFromDuration("1 hr 42 min", undefined), undefined);
	assert.equal(resetEpochFromDuration("1 hr 42 min", Number.NaN), undefined);
	assert.equal(resetEpochFromDuration("No credits yet", now), undefined);
});
