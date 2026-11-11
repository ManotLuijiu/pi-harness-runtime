import { test } from "node:test";
import assert from "node:assert/strict";
import {
	LOW_REMAINING_THRESHOLD_PCT,
	RESET_HORIZON_MS,
	decideQuotaReset,
	isBelowLowThreshold,
	isFullyExhausted,
	quotaWindowState,
	remainingPctFromUsedPct,
	usedPctFromRemainingPct,
} from "../harness/quota-threshold.ts";

const now = 1_000_000;
const minute = 60_000;

test("the visible percentage is the remaining percentage", () => {
	const close = (actual, expected) =>
		assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
	close(remainingPctFromUsedPct(100), 0);
	close(remainingPctFromUsedPct(90), 10);
	close(remainingPctFromUsedPct(90.1), 9.9);
	close(usedPctFromRemainingPct(0), 100);
	close(usedPctFromRemainingPct(9.9), 90.1);
	// The threshold itself is exact: ten percent of the allowance left.
	assert.equal(remainingPctFromUsedPct(90), LOW_REMAINING_THRESHOLD_PCT);
});

test("the threshold is ten percent of the remaining allowance", () => {
	assert.equal(LOW_REMAINING_THRESHOLD_PCT, 10);
	assert.equal(RESET_HORIZON_MS, 60 * minute);
});

test("the state of a window follows its remaining percentage", () => {
	assert.equal(quotaWindowState(undefined), "unknown");
	assert.equal(quotaWindowState(Number.NaN), "unknown");
	assert.equal(quotaWindowState(90), "available");
	assert.equal(quotaWindowState(90.1), "low");
	assert.equal(quotaWindowState(99), "low");
	assert.equal(quotaWindowState(100), "exhausted");
	assert.equal(quotaWindowState(101), "exhausted");
});

test("the helpers below the threshold follow the state", () => {
	assert.equal(isBelowLowThreshold(90), false);
	assert.equal(isBelowLowThreshold(90.1), true);
	assert.equal(isBelowLowThreshold(100), true);
	assert.equal(isBelowLowThreshold(undefined), false);
	assert.equal(isFullyExhausted(99), false);
	assert.equal(isFullyExhausted(100), true);
});

test("an empty window waits for its reset whatever the distance is", () => {
	assert.equal(
		decideQuotaReset({ usedPct: 100, resetAt: now + 30_000, now }),
		"reset",
	);
	assert.equal(
		decideQuotaReset({ usedPct: 100, resetAt: now + 10 * minute, now }),
		"reset",
	);
	assert.equal(
		decideQuotaReset({ usedPct: 100, resetAt: now + 5 * 60 * minute, now }),
		"reset",
	);
});

test("a nearly empty window waits only when the reset is far enough away", () => {
	// 9.9% left, the reset is more than an hour away.
	assert.equal(
		decideQuotaReset({ usedPct: 90.1, resetAt: now + 102 * minute, now }),
		"reset",
	);
	// 9.9% left, the reset is exactly an hour away: the cycle reaches it.
	assert.equal(
		decideQuotaReset({ usedPct: 90.1, resetAt: now + RESET_HORIZON_MS, now }),
		"bounded",
	);
	// 9.9% left, the reset is nearer than an hour.
	assert.equal(
		decideQuotaReset({ usedPct: 90.1, resetAt: now + 59 * minute, now }),
		"bounded",
	);
});

test("a window with an allowance keeps the bounded cycle", () => {
	assert.equal(
		decideQuotaReset({ usedPct: 90, resetAt: now + 5 * 60 * minute, now }),
		"bounded",
	);
	assert.equal(
		decideQuotaReset({ usedPct: 0, resetAt: now + 5 * 60 * minute, now }),
		"bounded",
	);
});

test("an unknown window and an unusable reset keep the bounded cycle", () => {
	assert.equal(
		decideQuotaReset({ usedPct: undefined, resetAt: now + 5 * 60 * minute, now }),
		"bounded",
	);
	assert.equal(
		decideQuotaReset({ usedPct: 100, resetAt: undefined, now }),
		"bounded",
	);
	assert.equal(
		decideQuotaReset({ usedPct: 100, resetAt: now - minute, now }),
		"bounded",
	);
	assert.equal(
		decideQuotaReset({ usedPct: 100, resetAt: Number.NaN, now }),
		"bounded",
	);
});
