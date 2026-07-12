/**
 * Tests for quota status formatting and footer badge output.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatQuotaStatus } from "../harness/e2e/quota-status.ts";
import { buildFooterStatusValue } from "../footer-status.ts";

test("formatQuotaStatus always includes weekly remaining quota", () => {
	const status = formatQuotaStatus({
		provider: "minimax",
		h5UsedPct: 0,
		weeklyUsedPct: 0,
		scrapedAt: "2026-07-11T00:00:00.000Z",
	});

	assert.equal(status.short, "5h: 100% left");
	assert.equal(status.extended, "5h: 100% left · week: 100% left");
});

test("buildFooterStatusValue prefers quota mirror data for footer badge", () => {
	const status = buildFooterStatusValue(
		{ today: { tokens: 12500, cost: 0.1234 } },
		{
			synced_at: "2026-07-11T00:00:00.000Z",
			provider: "minimax",
			h5_used_pct: 0,
			weekly_used_pct: 74,
		},
		"fresh",
	);

	assert.equal(status, "5h: 100% left · week: 26% left");
});

test("buildFooterStatusValue falls back to local today summary when mirror is missing", () => {
	const status = buildFooterStatusValue(
		{ today: { tokens: 12500, cost: 0.1234 } },
		null,
		"missing",
	);

	assert.equal(status, "today: 12.5k tok · $0.123");
});

test("buildFooterStatusValue marks stale quota mirror data", () => {
	const status = buildFooterStatusValue(
		{ today: { tokens: 12500, cost: 0.1234 } },
		{
			synced_at: "2026-07-11T00:00:00.000Z",
			provider: "minimax",
			h5_used_pct: 20,
			weekly_used_pct: 80,
		},
		"stale",
	);

	assert.equal(status, "5h: 80% left · week: 20% left · stale");
});

test("buildFooterStatusValue ignores expired mirror data and falls back to local today summary", () => {
	const status = buildFooterStatusValue(
		{ today: { tokens: 12500, cost: 0.1234 } },
		{
			synced_at: "2026-06-26T15:04:01.896Z",
			provider: "minimax",
			h5_used_pct: 0,
			weekly_used_pct: 74,
		},
		"expired",
	);

	assert.equal(status, "today: 12.5k tok · $0.123");
});
