/**
 * The exhaustion of the weekly allowance of a provider.
 *
 * The decision needs three facts, and every one of them has to be there:
 * the failure is a failure of the quota, the row of the mirror is fresh
 * and for this provider, and the weekly window of that row is empty with
 * a reset in the future.
 *
 * The clock is injected, so every deadline of this suite is exact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyProviderFailure } from "../harness/provider-failure.ts";
import {
	formatResetDuration,
	providerDisplayName,
	weeklyExhaustionMessage,
	weeklyQuotaExhausted,
} from "../harness/weekly-quota-exhaustion.ts";

const MINUTE = 60_000;
const NOW = 1_700_000_000_000;

/** The failure of MiniMax that ran out of its plan. */
const USAGE_LIMIT = "MiniMax usage limit reached (2067)";

/**
 * A row of the mirror.
 */
function mirror(overrides = {}) {
	return {
		synced_at: new Date(NOW - 60_000).toISOString(),
		provider: "minimax",
		source: "scrape",
		h5_used_pct: 100,
		h5_resets_at_epoch: NOW + 30 * MINUTE,
		weekly_used_pct: 100,
		weekly_resets_at_epoch: NOW + 2 * 86_400_000 + 7 * 3_600_000 + 58 * MINUTE,
		...overrides,
	};
}

test("an empty weekly window with a fresh row is the exhaustion of the week", () => {
	const failure = classifyProviderFailure(USAGE_LIMIT);
	const evidence = weeklyQuotaExhausted({
		failure,
		provider: "minimax",
		mirror: mirror(),
		now: NOW,
	});
	assert.ok(evidence, "the evidence of the empty week is found");
	assert.equal(evidence.provider, "minimax");
	assert.equal(evidence.remainingPct, 0);
	assert.equal(evidence.source, "scrape");
	assert.ok(evidence.resetAt > NOW);
});

test("a row of another provider proves nothing", () => {
	const failure = classifyProviderFailure(USAGE_LIMIT);
	const evidence = weeklyQuotaExhausted({
		failure,
		provider: "minimax",
		mirror: mirror({ provider: "glm" }),
		now: NOW,
	});
	assert.equal(evidence, undefined);
});

test("a row that is too old proves nothing", () => {
	const failure = classifyProviderFailure(USAGE_LIMIT);
	const evidence = weeklyQuotaExhausted({
		failure,
		provider: "minimax",
		mirror: mirror({ synced_at: new Date(NOW - 6 * 3_600_000).toISOString() }),
		now: NOW,
	});
	assert.equal(evidence, undefined);
});

test("a weekly window that still has its allowance is not an exhaustion", () => {
	const failure = classifyProviderFailure(USAGE_LIMIT);
	const evidence = weeklyQuotaExhausted({
		failure,
		provider: "minimax",
		mirror: mirror({ weekly_used_pct: 80 }),
		now: NOW,
	});
	assert.equal(evidence, undefined);
});

test("a weekly window without a reset in the future is not an exhaustion", () => {
	const failure = classifyProviderFailure(USAGE_LIMIT);
	const evidence = weeklyQuotaExhausted({
		failure,
		provider: "minimax",
		mirror: mirror({ weekly_resets_at_epoch: NOW - MINUTE }),
		now: NOW,
	});
	assert.equal(evidence, undefined);
});

test("a rejected credential says nothing about the weekly allowance", () => {
	const failure = classifyProviderFailure("401 unauthorized");
	const evidence = weeklyQuotaExhausted({
		failure,
		provider: "minimax",
		mirror: mirror(),
		now: NOW,
	});
	assert.equal(evidence, undefined);
});

test("the duration of a reset reads like the console of the provider", () => {
	assert.equal(formatResetDuration(2 * 86_400_000 + 7 * 3_600_000 + 58 * MINUTE), "2 days 7 hours 58 minutes");
	assert.equal(formatResetDuration(1 * 86_400_000 + 1 * 3_600_000), "1 day 1 hour");
	assert.equal(formatResetDuration(90_000), "1 minute");
	assert.equal(formatResetDuration(45_000), "45 seconds");
	assert.equal(formatResetDuration(0), "0 seconds");
});

test("the message of the empty week names the provider, the time and the work", () => {
	const resetAt = NOW + 2 * 86_400_000 + 7 * 3_600_000 + 58 * MINUTE;
	const message = weeklyExhaustionMessage({
		provider: "minimax",
		resetAt,
		now: NOW,
	});
	assert.equal(
		message,
		"MiniMax weekly quota exhausted. Resets in 2 days 7 hours 58 minutes. Work is paused.",
	);
});

test("the name of a provider is the name the user knows", () => {
	assert.equal(providerDisplayName("minimax"), "MiniMax");
	assert.equal(providerDisplayName("MiniMax"), "MiniMax");
	assert.equal(providerDisplayName("glm"), "GLM");
});
