/**
 * The shared quota refresh.
 *
 * A refresh reaches the provider. Several things can ask for one at the
 * same time, and two parallel refreshes would mean two browser captures
 * and two chances to trip a rate limit. The coordinator owns one refresh at
 * a time and shares it with every requester.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { QuotaRefreshCoordinator } from "../harness/quota-refresh-coordinator.ts";

/** A refresh that resolves when the test says so. */
function deferredRefresh() {
	let settle = null;
	const calls = [];
	const refresh = async () => {
		calls.push("call");
		await new Promise((resolve) => {
			settle = resolve;
		});
		return { ok: true, source: "cookie-cache" };
	};
	return {
		refresh,
		calls,
		resolve: () => settle?.(),
	};
}

test("a request runs one refresh", async () => {
	let calls = 0;
	const coordinator = new QuotaRefreshCoordinator({
		refresh: async () => {
			calls++;
			return { ok: true, source: "cookie-cache" };
		},
	});

	const outcome = await coordinator.request("test");
	assert.equal(calls, 1);
	assert.equal(outcome.ok, true);
	assert.equal(outcome.source, "cookie-cache");
	assert.equal(outcome.trigger, "test");
});

test("a burst of requests shares one refresh", async () => {
	const gate = deferredRefresh();
	const coordinator = new QuotaRefreshCoordinator({ refresh: gate.refresh });

	const first = coordinator.request("import");
	const second = coordinator.request("import");
	const third = coordinator.request("tick");
	assert.equal(gate.calls.length, 1);
	assert.equal(coordinator.isRefreshing, true);

	gate.resolve();
	const outcomes = await Promise.all([first, second, third]);
	assert.equal(gate.calls.length, 1);
	assert.deepEqual(
		outcomes.map((o) => o.ok),
		[true, true, true],
	);
});

test("a request after the refresh finished starts a new one", async () => {
	let calls = 0;
	const coordinator = new QuotaRefreshCoordinator({
		refresh: async () => {
			calls++;
			return { ok: true, source: "browser-profile" };
		},
	});

	await coordinator.request("first");
	await coordinator.request("second");
	assert.equal(calls, 2);
});

test("the outcome of a failure names the reason and the credential", async () => {
	const coordinator = new QuotaRefreshCoordinator({
		refresh: async () => ({
			ok: false,
			source: "cookie-cache",
			reason: "the session was refused",
		}),
	});

	const outcome = await coordinator.request("test");
	assert.equal(outcome.ok, false);
	assert.equal(outcome.source, "cookie-cache");
	assert.equal(outcome.reason, "the session was refused");
	assert.equal(coordinator.lastOutcome?.reason, "the session was refused");
});

test("a refresh that throws becomes a failed outcome", async () => {
	const coordinator = new QuotaRefreshCoordinator({
		refresh: async () => {
			throw new Error("the browser refused to start");
		},
	});

	const outcome = await coordinator.request("test");
	assert.equal(outcome.ok, false);
	assert.equal(outcome.source, "none");
	assert.equal(outcome.reason, "the browser refused to start");
});

test("the coordinator reports the last outcome", async () => {
	const coordinator = new QuotaRefreshCoordinator({
		refresh: async () => ({ ok: true, source: "browser-profile" }),
	});

	assert.equal(coordinator.lastOutcome, null);
	await coordinator.request("test");
	assert.equal(coordinator.lastOutcome?.source, "browser-profile");
	assert.equal(coordinator.isRefreshing, false);
});
