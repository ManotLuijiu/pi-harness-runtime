/**
 * The merge of a mirror record with the row it replaces.
 *
 * A write that knows no quota window must not throw the evidence of the
 * windows away: the signal of the TUI arrives with the failure of the
 * provider, and that is the moment the recovery needs the evidence of the
 * week.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeMirrorRecord } from "../harness/mirror-record-merge.ts";

const NOW = 1_700_000_000_000;

/** The row of a capture of the console of the provider. */
function scrapeRow(overrides = {}) {
	return {
		synced_at: new Date(NOW - 60_000).toISOString(),
		provider: "minimax",
		source: "scrape",
		model: "MiniMax-M2",
		h5_used_pct: 100,
		h5_resets_at_epoch: NOW + 30 * 60_000,
		weekly_used_pct: 100,
		weekly_resets_at_epoch: NOW + 2 * 86_400_000,
		...overrides,
	};
}

/** The write of a signal of the TUI: it knows no window. */
function signalRow(overrides = {}) {
	return {
		synced_at: new Date(NOW).toISOString(),
		provider: "minimax",
		source: "tui-signal",
		exhausted: true,
		limitType: "rate_limit",
		remainingPct: 0,
		...overrides,
	};
}

test("a reduced write keeps the evidence of the windows", () => {
	const merged = mergeMirrorRecord(scrapeRow(), signalRow());
	assert.equal(merged.weekly_used_pct, 100, "the evidence of the week survives");
	assert.equal(merged.weekly_resets_at_epoch, NOW + 2 * 86_400_000);
	assert.equal(merged.h5_used_pct, 100);
	assert.equal(merged.h5_resets_at_epoch, NOW + 30 * 60_000);
});

test("the row is as old as the evidence it carries", () => {
	const previous = scrapeRow();
	const merged = mergeMirrorRecord(previous, signalRow());
	assert.equal(
		merged.synced_at,
		previous.synced_at,
		"nothing claims to be fresher than the numbers of the row",
	);
	assert.equal(merged.source, "scrape");
});

test("the signal adds what it knows", () => {
	const merged = mergeMirrorRecord(scrapeRow(), signalRow());
	assert.equal(merged.exhausted, true);
	assert.equal(merged.remainingPct, 0);
	assert.equal(merged.limitType, "rate_limit");
	assert.equal(merged.model, "MiniMax-M2");
});

test("a full observation replaces the row", () => {
	const fresh = scrapeRow({
		synced_at: new Date(NOW).toISOString(),
		weekly_used_pct: 42,
	});
	const merged = mergeMirrorRecord(scrapeRow(), fresh);
	assert.equal(merged.weekly_used_pct, 42, "the newer capture wins");
	assert.equal(merged.synced_at, fresh.synced_at);
});

test("the first write of a provider is kept as it is", () => {
	const row = signalRow();
	assert.equal(mergeMirrorRecord(null, row), row);
});

test("a reduced write without evidence of its own is kept as it is", () => {
	const row = signalRow();
	const merged = mergeMirrorRecord(null, row);
	assert.equal(merged.remainingPct, 0);
});
