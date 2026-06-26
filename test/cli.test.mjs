/**
 * Tests for pure helpers in cli.ts (paths, formatting, IO).
 * Uses node --test format. No pi dependency.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	getUsageDir,
	getUsageLogPath,
	getMirrorPath,
	ensureUsageDir,
	readJsonl,
	appendJsonl,
	readJson,
	writeJson,
	formatDuration,
	formatRelative,
	formatTokens,
	formatUsd,
} from "../cli.ts";

// Override the usage dir for testing (set BEFORE importing)
const TEST_DIR = mkdtempSync(join(tmpdir(), "pi-usage-test-"));
process.env.PI_USAGE_DIR = TEST_DIR;

// ─── Path helpers ──────────────────────────────────────────────────

test("getUsageDir respects PI_USAGE_DIR override", () => {
	assert.equal(getUsageDir(), TEST_DIR);
});

test("getUsageLogPath is under usage dir", () => {
	const logPath = getUsageLogPath();
	assert.equal(logPath, join(TEST_DIR, "usage.jsonl"));
});

test("getMirrorPath is under usage dir", () => {
	const mirrorPath = getMirrorPath();
	assert.equal(mirrorPath, join(TEST_DIR, "mirror.json"));
});

// ─── ensureUsageDir ────────────────────────────────────────────────

test("ensureUsageDir creates dir if missing", () => {
	const newDir = join(TEST_DIR, "subdir", "nested");
	process.env.PI_USAGE_DIR = newDir;
	ensureUsageDir();
	assert.ok(existsSync(newDir), "directory should exist");
	// reset
	process.env.PI_USAGE_DIR = TEST_DIR;
	ensureUsageDir();
});

test("ensureUsageDir is idempotent", () => {
	ensureUsageDir();
	ensureUsageDir();
	assert.ok(existsSync(TEST_DIR));
});

// ─── JSONL helpers ─────────────────────────────────────────────────

test("appendJsonl + readJsonl round-trip", () => {
	const path = join(TEST_DIR, "test.jsonl");
	const r1 = { ts: 1, val: "a" };
	const r2 = { ts: 2, val: "b" };
	appendJsonl(path, r1);
	appendJsonl(path, r2);
	const out = readJsonl(path);
	assert.deepEqual(out, [r1, r2]);
});

test("readJsonl returns empty array if file missing", () => {
	const result = readJsonl("/nonexistent/path/file.jsonl");
	assert.deepEqual(result, []);
});

test("readJsonl skips corrupted lines", () => {
	const path = join(TEST_DIR, "corrupt.jsonl");
	writeFileSync(path, '{"ts":1}\nnot-json\n{"ts":2}\n', "utf-8");
	const out = readJsonl(path);
	assert.equal(out.length, 2);
	assert.equal(out[0].ts, 1);
	assert.equal(out[1].ts, 2);
});

// ─── JSON helpers ──────────────────────────────────────────────────

test("readJson returns null for missing file", () => {
	assert.equal(readJson("/nonexistent/file.json"), null);
});

test("readJson returns null for corrupted file", () => {
	const path = join(TEST_DIR, "bad.json");
	writeFileSync(path, "{not valid json", "utf-8");
	assert.equal(readJson(path), null);
});

test("writeJson + readJson round-trip", () => {
	const path = join(TEST_DIR, "data.json");
	const data = { foo: 1, bar: ["a", "b"] };
	writeJson(path, data);
	const read = readJson(path);
	assert.deepEqual(read, data);
});

// ─── Formatting ────────────────────────────────────────────────────

test("formatDuration handles seconds", () => {
	assert.equal(formatDuration(5_000), "5s");
	assert.equal(formatDuration(59_000), "59s");
});

test("formatDuration handles minutes", () => {
	assert.equal(formatDuration(60_000), "1m");
	assert.equal(formatDuration(90_000), "1m");
	assert.equal(formatDuration(60 * 60 * 1000), "1h 0m");
});

test("formatDuration handles hours + minutes", () => {
	assert.equal(formatDuration(2 * 60 * 60 * 1000 + 30 * 60 * 1000), "2h 30m");
});

test("formatDuration handles days", () => {
	assert.equal(formatDuration(3 * 24 * 60 * 60 * 1000), "3d 0h");
});

test("formatDuration clamps negatives to zero", () => {
	assert.equal(formatDuration(-1000), "0s");
});

test("formatRelative returns 'ago' string", () => {
	const now = Date.now();
	const past = new Date(now - 5 * 60 * 1000).toISOString();
	const result = formatRelative(past, now);
	assert.match(result, /^5m ago$/);
});

test("formatRelative handles invalid date", () => {
	assert.equal(formatRelative("not-a-date", Date.now()), "unknown");
});

test("formatTokens uses k suffix for thousands", () => {
	assert.equal(formatTokens(500), "500");
	assert.equal(formatTokens(1500), "1.5k");
	assert.equal(formatTokens(12345), "12.3k");
});

test("formatTokens uses M suffix for millions", () => {
	assert.equal(formatTokens(1_500_000), "1.50M");
	assert.equal(formatTokens(12_345_678), "12.35M");
});

test("formatUsd handles small/large values", () => {
	assert.equal(formatUsd(0.0001), "$0.0001");
	assert.equal(formatUsd(0.5), "$0.50");
	assert.equal(formatUsd(50), "$50.00");
	assert.equal(formatUsd(1500), "$1500");
});

// ─── Cleanup ───────────────────────────────────────────────────────

test("cleanup", () => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});