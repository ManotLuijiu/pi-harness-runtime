/**
 * Tests for UsageTracker (JSONL append-only log).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UsageTracker } from "../tracker.ts";

const TEST_DIR = mkdtempSync(join(tmpdir(), "pi-usage-tracker-"));
process.env.PI_USAGE_DIR = TEST_DIR;

test("append + all round-trip", () => {
	const tracker = new UsageTracker(join(TEST_DIR, "log.jsonl"));
	tracker.append({ ts: 1000, model: "m1", input: 10, output: 5, cache_read: 0, cache_write: 0, cost: 0.001 });
	tracker.append({ ts: 2000, model: "m1", input: 20, output: 8, cache_read: 0, cache_write: 0, cost: 0.002 });

	const all = tracker.all();
	assert.equal(all.length, 2);
	assert.equal(all[0].ts, 1000);
	assert.equal(all[0].input, 10);
	assert.equal(all[1].cost, 0.002);
});

test("all() returns empty if file missing", () => {
	const tracker = new UsageTracker(join(TEST_DIR, "nonexistent.jsonl"));
	assert.deepEqual(tracker.all(), []);
});

test("since() filters by timestamp", () => {
	const tracker = new UsageTracker(join(TEST_DIR, "log2.jsonl"));
	tracker.append({ ts: 1000, model: "m", input: 1, output: 1, cache_read: 0, cache_write: 0, cost: 0 });
	tracker.append({ ts: 2000, model: "m", input: 1, output: 1, cache_read: 0, cache_write: 0, cost: 0 });
	tracker.append({ ts: 3000, model: "m", input: 1, output: 1, cache_read: 0, cache_write: 0, cost: 0 });

	const out = tracker.since(2000);
	assert.equal(out.length, 2);
	assert.equal(out[0].ts, 2000);
	assert.equal(out[1].ts, 3000);
});

test("between() includes fromMs, excludes toMs", () => {
	const tracker = new UsageTracker(join(TEST_DIR, "log3.jsonl"));
	tracker.append({ ts: 1000, model: "m", input: 1, output: 1, cache_read: 0, cache_write: 0, cost: 0 });
	tracker.append({ ts: 2000, model: "m", input: 1, output: 1, cache_read: 0, cache_write: 0, cost: 0 });
	tracker.append({ ts: 3000, model: "m", input: 1, output: 1, cache_read: 0, cache_write: 0, cost: 0 });

	const out = tracker.between(1000, 3000);
	assert.equal(out.length, 2);
	assert.equal(out[0].ts, 1000);
	assert.equal(out[1].ts, 2000);
});

test("count() returns total records", () => {
	const tracker = new UsageTracker(join(TEST_DIR, "log4.jsonl"));
	assert.equal(tracker.count(), 0);
	tracker.append({ ts: 1, model: "m", input: 1, output: 1, cache_read: 0, cache_write: 0, cost: 0 });
	tracker.append({ ts: 2, model: "m", input: 1, output: 1, cache_read: 0, cache_write: 0, cost: 0 });
	assert.equal(tracker.count(), 2);
});

test("clear() removes the log file", () => {
	const path = join(TEST_DIR, "log5.jsonl");
	const tracker = new UsageTracker(path);
	tracker.append({ ts: 1, model: "m", input: 1, output: 1, cache_read: 0, cache_write: 0, cost: 0 });
	assert.ok(existsSync(path));
	tracker.clear();
	assert.ok(!existsSync(path));
});

test("cleanup", () => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});