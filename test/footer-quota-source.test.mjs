/**
 * The footer of the quota state.
 *
 * Three facts are separate: the credential was found, it was imported, and
 * the provider accepted it. The footer keeps them apart, and it never
 * claims a reset time that it does not have.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildFooterStatusValue } from "../footer-status.ts";

const local = { today: { tokens: 12500, cost: 0.1234 } };

test("a reset that is not known is never rendered as a near reset", () => {
	const status = buildFooterStatusValue(
		local,
		{
			synced_at: "2026-07-11T00:00:00.000Z",
			provider: "minimax",
			h5_used_pct: 0,
			weekly_used_pct: 74,
		},
		"fresh",
		{ stage: "imported" },
	);
	assert.ok(!status.includes("soon"));
	assert.ok(status.includes("reset time unknown"));
});

test("a generic rate-limit signal without a reset says the reset is unknown", () => {
	const status = buildFooterStatusValue(
		local,
		{
			synced_at: "2026-07-11T00:00:00.000Z",
			provider: "minimax",
			exhausted: true,
			limitType: "rate_limit",
		},
		"fresh",
		{ stage: "imported" },
	);
	assert.equal(status, "MiniMax: rate_limit hit, reset time unknown");
});

test("a rate-limit signal does not hide the window percentages", () => {
	const status = buildFooterStatusValue(
		local,
		{
			synced_at: "2026-07-11T00:00:00.000Z",
			provider: "minimax",
			exhausted: true,
			limitType: "rate_limit",
			h5_used_pct: 20,
			weekly_used_pct: 74,
		},
		"fresh",
		{ stage: "imported" },
	);
	assert.ok(status.includes("5h: 80% left"));
	assert.ok(status.includes("week: 26% left"));
	assert.ok(status.includes("rate_limit hit"));
});

test("a found file that was not imported says so", () => {
	const status = buildFooterStatusValue(
		local,
		null,
		"missing",
		{ stage: "discovered" },
		"minimax",
	);
	assert.ok(status.includes("found but not imported"));
});

test("no credential at all names the drop folder", () => {
	const status = buildFooterStatusValue(
		local,
		null,
		"missing",
		{ stage: "none" },
		"minimax",
	);
	assert.ok(status.includes("~/.pi-harness-runtime/cookies/"));
});

test("a failed refresh names its reason", () => {
	const status = buildFooterStatusValue(
		local,
		null,
		"missing",
		{
			stage: "imported",
			lastFetch: {
				ok: false,
				source: "cookie-cache",
				reason: "the session was refused",
			},
		},
		"minimax",
	);
	assert.ok(status.includes("the last refresh failed"));
	assert.ok(status.includes("the session was refused"));
});

test("a successful refresh adds no failure note", () => {
	const status = buildFooterStatusValue(
		local,
		null,
		"missing",
		{
			stage: "imported",
			lastFetch: { ok: true, source: "cookie-cache" },
		},
		"minimax",
	);
	assert.ok(!status.includes("the last refresh failed"));
});
