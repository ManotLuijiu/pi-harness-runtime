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

test("positive, missing, stale, foreign, and expired quota cannot establish a wait", () => {
	for (const quota of [undefined, mirror({ h5_used_pct: 99 }), mirror({ h5_used_pct: undefined }),
		mirror({ synced_at: new Date(now - 31 * minute).toISOString() }), mirror({ provider: "other" }),
		mirror({ h5_resets_at_epoch: now }), mirror({ h5_resets_at_epoch: undefined }),
		mirror({ synced_at: new Date(now + minute).toISOString() })]) {
		assert.equal(confirmedQuotaReset(failure, "minimax", quota, now), undefined);
	}
});

test("credential and overload failures do not enter quota recovery", () => {
	for (const text of ["401 unauthorized", "529 overloaded"]) {
		assert.equal(confirmedQuotaReset(classifyProviderFailure(text), "minimax", mirror(), now), undefined);
	}
});
