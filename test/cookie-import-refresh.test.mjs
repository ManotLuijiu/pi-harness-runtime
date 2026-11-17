/**
 * The reaction of the runtime to a cookie import.
 *
 * An import publishes a new canonical cache, so the quota of the provider
 * is probably different. The reaction asks for one shared refresh, and a
 * burst of watcher events asks once.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	handleCookieWatcherEvent,
	COOKIE_IMPORT_TRIGGER,
} from "../harness/cookie-import-refresh.ts";
import { QuotaRefreshCoordinator } from "../harness/quota-refresh-coordinator.ts";

function collect() {
	const refreshes = [];
	const logs = [];
	return {
		refreshes,
		logs,
		options: {
			requestRefresh: (trigger) => {
				refreshes.push(trigger);
			},
			log: (message) => {
				logs.push(message);
			},
		},
	};
}

test("a successful import asks for one refresh", () => {
	const { refreshes, options } = collect();
	handleCookieWatcherEvent(
		{
			kind: "sync-ok",
			provider: "minimax",
			cachePath: "/tmp/cache.txt",
			cookies: 12,
		},
		options,
	);
	assert.deepEqual(refreshes, [COOKIE_IMPORT_TRIGGER]);
});

test("a failed import asks for nothing", () => {
	const { refreshes, logs, options } = collect();
	handleCookieWatcherEvent(
		{ kind: "sync-error", message: "minimax.txt: the rows did not validate" },
		options,
	);
	assert.equal(refreshes.length, 0);
	assert.equal(logs.length, 1);
	assert.ok(logs[0].includes("minimax.txt"));
});

test("a watcher error is logged", () => {
	const { refreshes, logs, options } = collect();
	handleCookieWatcherEvent(
		{ kind: "watcher-error", message: "the folder is gone" },
		options,
	);
	assert.equal(refreshes.length, 0);
	assert.equal(logs.length, 1);
});

test("an exhausted watcher limit names the fix", () => {
	const { logs, options } = collect();
	handleCookieWatcherEvent(
		{ kind: "watcher-error", message: "ENOSPC: too many watchers" },
		options,
	);
	assert.equal(logs.length, 1);
	assert.ok(logs[0].includes("ENOSPC"));
	assert.ok(logs[0].includes("max_user_watches"));
});

test("a burst of imports shares one refresh", async () => {
	const { refreshes, options } = collect();
	const coordinator = new QuotaRefreshCoordinator({
		refresh: async () => {
			refreshes.push("fetch");
			await new Promise((resolve) => setTimeout(resolve, 5));
			return { ok: true, source: "cookie-cache" };
		},
	});

	const first = coordinator.request(COOKIE_IMPORT_TRIGGER);
	const second = coordinator.request(COOKIE_IMPORT_TRIGGER);
	const third = coordinator.request(COOKIE_IMPORT_TRIGGER);
	await Promise.all([first, second, third]);

	assert.equal(refreshes.filter((r) => r === "fetch").length, 1);
});

test("an import after a failure still asks for a refresh", () => {
	const { refreshes, options } = collect();
	handleCookieWatcherEvent(
		{ kind: "sync-error", message: "the rows did not validate" },
		options,
	);
	handleCookieWatcherEvent(
		{
			kind: "sync-ok",
			provider: "minimax",
			cachePath: "/tmp/cache.txt",
			cookies: 3,
		},
		options,
	);
	assert.deepEqual(refreshes, [COOKIE_IMPORT_TRIGGER]);
});
