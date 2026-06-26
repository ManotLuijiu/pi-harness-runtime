/**
 * Tests for MirrorStore (JSON read/write + freshness).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MirrorStore } from "../mirror.ts";

const TEST_DIR = mkdtempSync(join(tmpdir(), "pi-usage-mirror-"));
process.env.PI_USAGE_DIR = TEST_DIR;

test("read returns null if missing", () => {
	const store = new MirrorStore(join(TEST_DIR, "missing.json"));
	assert.equal(store.read(), null);
});

test("write + read round-trip", () => {
	const path = join(TEST_DIR, "mirror.json");
	const store = new MirrorStore(path);
	const record = {
		synced_at: "2026-06-26T15:00:00.000Z",
		provider: "minimax",
		h5_used_pct: 18,
		h5_resets_at: "2026-06-26T20:00:00.000Z",
		weekly_used_pct: 72,
		weekly_resets_at: "2026-06-28T22:00:00.000Z",
	};
	store.write(record);
	const read = store.read();
	assert.deepEqual(read, record);
	assert.ok(existsSync(path));
});

test("freshness returns 'missing' if no record", () => {
	const store = new MirrorStore(join(TEST_DIR, "nope.json"));
	assert.equal(store.freshness(null, Date.now()), "missing");
});

test("freshness returns 'fresh' for < 30min old", () => {
	const store = new MirrorStore(join(TEST_DIR, "fresh.json"));
	const now = Date.now();
	const recent = new Date(now - 5 * 60 * 1000).toISOString();
	const record = { synced_at: recent, provider: "minimax" };
	assert.equal(store.freshness(record, now), "fresh");
});

test("freshness returns 'stale' for 30min-2h old", () => {
	const store = new MirrorStore(join(TEST_DIR, "stale.json"));
	const now = Date.now();
	const oldish = new Date(now - 60 * 60 * 1000).toISOString();
	const record = { synced_at: oldish, provider: "minimax" };
	assert.equal(store.freshness(record, now), "stale");
});

test("freshness returns 'expired' for > 2h old", () => {
	const store = new MirrorStore(join(TEST_DIR, "expired.json"));
	const now = Date.now();
	const ancient = new Date(now - 3 * 60 * 60 * 1000).toISOString();
	const record = { synced_at: ancient, provider: "minimax" };
	assert.equal(store.freshness(record, now), "expired");
});

test("isExpired mirrors 'expired' state", () => {
	const store = new MirrorStore(join(TEST_DIR, "isexp.json"));
	const now = Date.now();
	const old = { synced_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(), provider: "m" };
	assert.equal(store.isExpired(old, now), true);

	const recent = { synced_at: new Date(now - 5 * 60 * 1000).toISOString(), provider: "m" };
	assert.equal(store.isExpired(recent, now), false);
});

test("ageString returns 'never' for null record", () => {
	const store = new MirrorStore(join(TEST_DIR, "null.json"));
	assert.equal(store.ageString(null, Date.now()), "never");
});

test("ageString returns 'X min ago' for recent", () => {
	const store = new MirrorStore(join(TEST_DIR, "age.json"));
	const now = Date.now();
	const recent = new Date(now - 3 * 60 * 1000).toISOString();
	assert.equal(store.ageString({ synced_at: recent }, now), "3 min ago");
});

test("ageString returns 'X h ago' for older", () => {
	const store = new MirrorStore(join(TEST_DIR, "age2.json"));
	const now = Date.now();
	const older = new Date(now - 2 * 60 * 60 * 1000).toISOString();
	assert.equal(store.ageString({ synced_at: older }, now), "2 h ago");
});

test("ageString returns 'X d ago' for days old", () => {
	const store = new MirrorStore(join(TEST_DIR, "age3.json"));
	const now = Date.now();
	const ancient = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
	assert.equal(store.ageString({ synced_at: ancient }, now), "3 d ago");
});

test("cleanup", () => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});