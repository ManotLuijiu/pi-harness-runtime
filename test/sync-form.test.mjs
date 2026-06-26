/**
 * Tests for sync form parsing and record building.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	computeResetIso,
	buildMirrorRecord,
	parseSyncValues,
	handleSyncSubmit,
} from "../sync-form.ts";
import { MirrorStore } from "../mirror.ts";

const TEST_DIR = mkdtempSync(join(tmpdir(), "pi-usage-sync-"));
process.env.PI_USAGE_DIR = TEST_DIR;

const NOW = Date.UTC(2026, 5, 26, 15, 0, 0);   // 2026-06-26 15:00:00 UTC

// ─── computeResetIso ───────────────────────────────────────────────

test("computeResetIso adds hours and minutes", () => {
	const iso = computeResetIso(NOW, 4, 56);
	const parsed = Date.parse(iso);
	assert.equal(parsed, NOW + 4 * 3600_000 + 56 * 60_000);
});

test("computeResetIso handles zero", () => {
	const iso = computeResetIso(NOW, 0, 0);
	assert.equal(Date.parse(iso), NOW);
});

// ─── buildMirrorRecord ─────────────────────────────────────────────

test("buildMirrorRecord sets all fields", () => {
	const values = {
		h5_used_pct: 18,
		h5_resets_h: 4,
		h5_resets_m: 56,
		weekly_used_pct: 72,
		weekly_resets_d: 2,
		weekly_resets_h: 13,
	};
	const rec = buildMirrorRecord(values, "minimax", NOW);
	assert.equal(rec.synced_at, new Date(NOW).toISOString());
	assert.equal(rec.provider, "minimax");
	assert.equal(rec.h5_used_pct, 18);
	assert.equal(rec.weekly_used_pct, 72);
	assert.ok(rec.h5_resets_at);
	assert.ok(rec.weekly_resets_at);
});

test("buildMirrorRecord weekly reset combines days + hours", () => {
	const values = {
		h5_used_pct: 0, h5_resets_h: 0, h5_resets_m: 0,
		weekly_used_pct: 0, weekly_resets_d: 2, weekly_resets_h: 13,
	};
	const rec = buildMirrorRecord(values, "minimax", NOW);
	const weeklyReset = Date.parse(rec.weekly_resets_at);
	const expected = NOW + (2 * 24 + 13) * 3600_000;
	assert.equal(weeklyReset, expected);
});

// ─── parseSyncValues ───────────────────────────────────────────────

test("parseSyncValues accepts valid input", () => {
	const result = parseSyncValues({
		h5_used_pct: "18",
		h5_resets_h: "4",
		h5_resets_m: "56",
		weekly_used_pct: "72",
		weekly_resets_d: "2",
		weekly_resets_h: "13",
	});
	assert.deepEqual(result, {
		h5_used_pct: 18,
		h5_resets_h: 4,
		h5_resets_m: 56,
		weekly_used_pct: 72,
		weekly_resets_d: 2,
		weekly_resets_h: 13,
	});
});

test("parseSyncValues rejects out-of-range percentages", () => {
	const result = parseSyncValues({
		h5_used_pct: "150",
		h5_resets_h: "4",
		h5_resets_m: "56",
		weekly_used_pct: "72",
		weekly_resets_d: "2",
		weekly_resets_h: "13",
	});
	assert.equal(result, null);
});

test("parseSyncValues rejects negative values", () => {
	const result = parseSyncValues({
		h5_used_pct: "-5",
		h5_resets_h: "4",
		h5_resets_m: "56",
		weekly_used_pct: "72",
		weekly_resets_d: "2",
		weekly_resets_h: "13",
	});
	assert.equal(result, null);
});

test("parseSyncValues rejects non-numeric", () => {
	const result = parseSyncValues({
		h5_used_pct: "abc",
		h5_resets_h: "4",
		h5_resets_m: "56",
		weekly_used_pct: "72",
		weekly_resets_d: "2",
		weekly_resets_h: "13",
	});
	assert.equal(result, null);
});

test("parseSyncValues rejects hours > 24", () => {
	const result = parseSyncValues({
		h5_used_pct: "10",
		h5_resets_h: "25",
		h5_resets_m: "0",
		weekly_used_pct: "10",
		weekly_resets_d: "0",
		weekly_resets_h: "0",
	});
	assert.equal(result, null);
});

test("parseSyncValues rejects minutes > 59", () => {
	const result = parseSyncValues({
		h5_used_pct: "10",
		h5_resets_h: "0",
		h5_resets_m: "60",
		weekly_used_pct: "10",
		weekly_resets_d: "0",
		weekly_resets_h: "0",
	});
	assert.equal(result, null);
});

test("parseSyncValues rejects days > 7", () => {
	const result = parseSyncValues({
		h5_used_pct: "10",
		h5_resets_h: "0",
		h5_resets_m: "0",
		weekly_used_pct: "10",
		weekly_resets_d: "8",
		weekly_resets_h: "0",
	});
	assert.equal(result, null);
});

// ─── handleSyncSubmit ──────────────────────────────────────────────

test("handleSyncSubmit writes to disk and returns record", async () => {
	const store = new MirrorStore(join(TEST_DIR, "submit.json"));
	const record = await handleSyncSubmit(
		{
			h5_used_pct: 18,
			h5_resets_h: 4,
			h5_resets_m: 56,
			weekly_used_pct: 72,
			weekly_resets_d: 2,
			weekly_resets_h: 13,
		},
		store,
		"minimax",
	);
	assert.equal(record.provider, "minimax");
	assert.equal(record.h5_used_pct, 18);
	const readBack = store.read();
	assert.deepEqual(readBack, record);
});

test("cleanup", () => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});