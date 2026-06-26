/**
 * Tests for StatusRenderer (progress bars + full status output).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderProgressBar, renderStatus } from "../renderer.ts";
import { aggregateWindows } from "../windows.ts";
import { MirrorStore } from "../mirror.ts";

const NOW = Date.UTC(2026, 5, 26, 15, 0, 0);

function rec(ts, input = 100, output = 50, cost = 0.001) {
	return { ts, model: "m", input, output, cache_read: 0, cache_write: 0, cost };
}

// ─── renderProgressBar ─────────────────────────────────────────────

test("renderProgressBar empty", () => {
	const bar = renderProgressBar(0, 10);
	assert.equal(bar, "[░░░░░░░░░░]");
});

test("renderProgressBar full", () => {
	const bar = renderProgressBar(100, 10);
	assert.equal(bar, "[██████████]");
});

test("renderProgressBar half", () => {
	const bar = renderProgressBar(50, 10);
	assert.equal(bar, "[█████░░░░░]");
});

test("renderProgressBar clamps > 100", () => {
	const bar = renderProgressBar(150, 10);
	assert.equal(bar, "[██████████]");
});

test("renderProgressBar clamps < 0", () => {
	const bar = renderProgressBar(-10, 10);
	assert.equal(bar, "[░░░░░░░░░░]");
});

test("renderProgressBar default width 20", () => {
	const bar = renderProgressBar(50);
	assert.ok(bar.startsWith("["));
	assert.ok(bar.endsWith("]"));
	assert.equal(bar.length, 22);  // 20 chars + 2 brackets
});

// ─── renderStatus ──────────────────────────────────────────────────

test("renderStatus includes model and cwd", () => {
	const local = aggregateWindows([], NOW);
	const store = new MirrorStore();
	const out = renderStatus({
		model: "minimax/MiniMax-M3",
		cwd: "/home/test",
		local,
		mirror: null,
		mirrorStore: store,
		nowMs: NOW,
	});
	assert.match(out, /minimax\/MiniMax-M3/);
	assert.match(out, /\/home\/test/);
});

test("renderStatus shows 'No requests' when empty", () => {
	const local = aggregateWindows([], NOW);
	const store = new MirrorStore();
	const out = renderStatus({
		model: "m",
		cwd: "/x",
		local,
		mirror: null,
		mirrorStore: store,
		nowMs: NOW,
	});
	assert.match(out, /This 5h:\s+0 tokens/);
	assert.match(out, /Lifetime:\s+0 requests/);
});

test("renderStatus with mirror shows progress bars", () => {
	const local = aggregateWindows([rec(NOW - 60_000, 100, 50, 0.001)], NOW);
	const store = new MirrorStore();
	const mirror = {
		synced_at: new Date(NOW - 2 * 60 * 1000).toISOString(),
		provider: "minimax",
		h5_used_pct: 18,
		h5_resets_at: new Date(NOW + 4 * 60 * 60 * 1000).toISOString(),
		weekly_used_pct: 72,
		weekly_resets_at: new Date(NOW + 2 * 24 * 60 * 60 * 1000 + 13 * 60 * 60 * 1000).toISOString(),
	};
	const out = renderStatus({
		model: "m",
		cwd: "/x",
		local,
		mirror,
		mirrorStore: store,
		nowMs: NOW,
	});
	// Renderer shows REMAINING % (Codex style), so 100 - 18 = 82% left, 100 - 72 = 28% left
	assert.match(out, /82% left/);
	assert.match(out, /28% left/);
	assert.match(out, /resets in/);
	assert.match(out, /fresh/);   // < 30 min old
});

test("renderStatus shows EXPIRED for old mirror", () => {
	const local = aggregateWindows([], NOW);
	const store = new MirrorStore();
	const mirror = {
		synced_at: new Date(NOW - 5 * 60 * 60 * 1000).toISOString(),
		provider: "minimax",
		h5_used_pct: 50,
	};
	const out = renderStatus({
		model: "m",
		cwd: "/x",
		local,
		mirror,
		mirrorStore: store,
		nowMs: NOW,
	});
	assert.match(out, /EXPIRED/);
});

test("renderStatus shows 'Not synced yet' when mirror missing", () => {
	const local = aggregateWindows([], NOW);
	const store = new MirrorStore();
	const out = renderStatus({
		model: "m",
		cwd: "/x",
		local,
		mirror: null,
		mirrorStore: store,
		nowMs: NOW,
	});
	assert.match(out, /Not synced yet/);
});

test("renderStatus shows divergence warning", () => {
	const local = aggregateWindows([], NOW);
	const store = new MirrorStore();
	const mirror = {
		synced_at: new Date(NOW - 60_000).toISOString(),
		provider: "minimax",
		h5_used_pct: 10,   // mirror says 10% used
		// localFiveHLimitTokens = 1000 would give localPct = 0
	};
	const out = renderStatus({
		model: "m",
		cwd: "/x",
		local,
		mirror,
		mirrorStore: store,
		nowMs: NOW,
		localFiveHLimitTokens: 1000,
	});
	assert.match(out, /Local-vs-mirror/);
});

test("renderStatus includes burn rate", () => {
	const local = aggregateWindows([], NOW);
	const store = new MirrorStore();
	const mirror = {
		synced_at: new Date(NOW - 60_000).toISOString(),
		provider: "minimax",
		weekly_used_pct: 50,
		weekly_resets_at: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(),
	};
	const out = renderStatus({
		model: "m",
		cwd: "/x",
		local,
		mirror,
		mirrorStore: store,
		nowMs: NOW,
	});
	assert.match(out, /Burn rate:\s+50\.0% \/ day/);
});