/**
 * Tests for WindowAggregator (5h/weekly aggregation, reset time math).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	aggregateWindows,
	computeLocalResetTime,
	computeBurnRate,
	computeLocalVsMirrorDelta,
	FIVE_HOURS_MS,
	SEVEN_DAYS_MS,
} from "../windows.ts";

const NOW = Date.UTC(2026, 5, 26, 15, 0, 0);   // 2026-06-26 15:00 UTC

function rec(ts, input = 10, output = 5, cost = 0.001) {
	return { ts, model: "m", input, output, cache_read: 0, cache_write: 0, cost };
}

test("aggregateWindows empty input", () => {
	const w = aggregateWindows([], NOW);
	assert.equal(w.five_h.tokens, 0);
	assert.equal(w.five_h.requests, 0);
	assert.equal(w.five_h.oldest_ts, null);
	assert.equal(w.lifetime.requests, 0);
});

test("aggregateWindows includes 5h records only", () => {
	const records = [
		rec(NOW - 6 * 60 * 60 * 1000, 100, 50, 0.01),  // 6h ago — outside 5h
		rec(NOW - 2 * 60 * 60 * 1000, 100, 50, 0.01),  // 2h ago — inside
		rec(NOW - 1 * 60 * 60 * 1000, 100, 50, 0.01),  // 1h ago — inside
	];
	const w = aggregateWindows(records, NOW);
	assert.equal(w.five_h.requests, 2);
	assert.equal(w.five_h.tokens, 300);   // 2 * (100+50)
	assert.equal(w.lifetime.requests, 3);
});

test("aggregateWindows weekly window", () => {
	const records = [
		rec(NOW - 8 * 24 * 60 * 60 * 1000, 100, 50, 0.01),  // 8d ago — outside weekly
		rec(NOW - 3 * 24 * 60 * 60 * 1000, 100, 50, 0.01),  // 3d ago — inside
		rec(NOW - 1 * 24 * 60 * 60 * 1000, 100, 50, 0.01),  // 1d ago — inside
	];
	const w = aggregateWindows(records, NOW);
	assert.equal(w.weekly.requests, 2);
	assert.equal(w.lifetime.requests, 3);
});

test("aggregateWindows oldest_ts tracks oldest in window", () => {
	const records = [
		rec(NOW - 4 * 60 * 60 * 1000),
		rec(NOW - 1 * 60 * 60 * 1000),
		rec(NOW - 3 * 60 * 60 * 1000),
	];
	const w = aggregateWindows(records, NOW);
	assert.equal(w.five_h.oldest_ts, NOW - 4 * 60 * 60 * 1000);
});

test("computeLocalResetTime returns null for empty window", () => {
	const w = aggregateWindows([], NOW);
	assert.equal(computeLocalResetTime(w.five_h, FIVE_HOURS_MS), null);
});

test("computeLocalResetTime adds window to oldest record", () => {
	const records = [rec(NOW - 1 * 60 * 60 * 1000)];
	const w = aggregateWindows(records, NOW);
	const reset = computeLocalResetTime(w.five_h, FIVE_HOURS_MS);
	assert.equal(reset, NOW - 1 * 60 * 60 * 1000 + FIVE_HOURS_MS);
});

test("computeBurnRate basic", () => {
	const resetMs = NOW - 2 * 24 * 60 * 60 * 1000;  // reset was 2 days ago
	const used = 40;  // 40% used in 2 days
	const result = computeBurnRate(used, resetMs, NOW);
	assert.equal(result.pct_per_day, 20);   // 40 / 2
	assert.equal(result.days_until_full, 3); // 60 / 20
});

test("computeBurnRate zero elapsed", () => {
	const result = computeBurnRate(0, NOW, NOW);
	assert.equal(result.pct_per_day, 0);
	assert.equal(result.days_until_full, null);
});

test("computeBurnRate zero burn rate", () => {
	const resetMs = NOW - 1 * 24 * 60 * 60 * 1000;
	const result = computeBurnRate(0, resetMs, NOW);
	assert.equal(result.pct_per_day, 0);
	assert.equal(result.days_until_full, null);
});

test("computeLocalVsMirrorDelta positive divergence", () => {
	assert.equal(computeLocalVsMirrorDelta(20, 10), 10);
});

test("computeLocalVsMirrorDelta negative divergence", () => {
	assert.equal(computeLocalVsMirrorDelta(5, 25), -20);
});

test("computeLocalVsMirrorDelta null if mirror undefined", () => {
	assert.equal(computeLocalVsMirrorDelta(20, undefined), null);
});