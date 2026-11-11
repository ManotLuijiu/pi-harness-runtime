import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProviderFailure } from "../harness/provider-failure.ts";
import { confirmedQuotaReset, QUOTA_RESET_BUFFER_MS } from "../harness/provider-quota-reset.ts";

const now = 1_000_000;
const minute = 60_000;
const failure = classifyProviderFailure('429 {"type":"rate_limit_error","message":"The Token Plan usage limit has been reached. (2067)"}');
const mirror = (patch = {}) => ({
	provider: "minimax", synced_at: new Date(now).toISOString(), source: "scrape",
	h5_used_pct: 100, h5_resets_at_epoch: now + 102 * minute,
	weekly_used_pct: 50, weekly_resets_at_epoch: now + 7 * 24 * 60 * minute,
	...patch,
});

test("generic 2067 uses confirmed five-hour exhaustion and the requested buffer", () => {
	assert.equal(failure.window, undefined);
	const evidence = confirmedQuotaReset(failure, "MiniMax", mirror(), now);
	assert.equal(evidence.window, "h5");
	assert.equal(evidence.resetAt + QUOTA_RESET_BUFFER_MS, now + 112 * minute);
});

test("both exhausted windows require the later reset", () => {
	const quota = mirror({ weekly_used_pct: 100 });
	const evidence = confirmedQuotaReset(failure, "minimax", quota, now);
	assert.equal(evidence.window, "weekly");
	assert.equal(evidence.resetAt, quota.weekly_resets_at_epoch);
});

test("missing, stale, foreign, and expired quota cannot establish a wait", () => {
	for (const quota of [undefined, mirror({ h5_used_pct: undefined }),
		mirror({ synced_at: new Date(now - 31 * minute).toISOString() }), mirror({ provider: "other" }),
		mirror({ h5_resets_at_epoch: now }), mirror({ h5_resets_at_epoch: undefined }),
		mirror({ synced_at: new Date(now + minute).toISOString() })]) {
		assert.equal(confirmedQuotaReset(failure, "minimax", quota, now), undefined);
	}
});

test("the low-allowance threshold decides on the used percentage of the mirror", () => {
	// 9.9% left and a reset that is more than an hour away: the reset decides.
	const low = mirror({ h5_used_pct: 90.1 });
	const evidence = confirmedQuotaReset(failure, "minimax", low, now);
	assert.equal(evidence.window, "h5");
	assert.equal(evidence.resetAt, low.h5_resets_at_epoch);

	// 10% left is not below the threshold: the bounded cycle keeps the failure.
	assert.equal(
		confirmedQuotaReset(failure, "minimax", mirror({ h5_used_pct: 90 }), now),
		undefined,
	);

	// A reset that arrives within the hour is reached by the bounded cycle.
	assert.equal(
		confirmedQuotaReset(failure, "minimax", mirror({ h5_used_pct: 90.1, h5_resets_at_epoch: now + 59 * minute }), now),
		undefined,
	);

	// An empty window waits for a reset that arrives within the hour as well.
	const empty = mirror({ h5_used_pct: 100, h5_resets_at_epoch: now + 30 * minute });
	const emptyEvidence = confirmedQuotaReset(failure, "minimax", empty, now);
	assert.equal(emptyEvidence.window, "h5");
	assert.equal(emptyEvidence.resetAt, empty.h5_resets_at_epoch);
});

test("an empty window decides before a nearly empty one", () => {
	// The weekly window is empty and resets later: the later reset decides.
	const quota = mirror({ h5_used_pct: 90.1, weekly_used_pct: 100 });
	const evidence = confirmedQuotaReset(failure, "minimax", quota, now);
	assert.equal(evidence.window, "weekly");
	assert.equal(evidence.resetAt, quota.weekly_resets_at_epoch);
});

test("credential and overload failures do not enter quota recovery", () => {
	for (const text of ["401 unauthorized", "529 overloaded"]) {
		assert.equal(confirmedQuotaReset(classifyProviderFailure(text), "minimax", mirror(), now), undefined);
	}
});
