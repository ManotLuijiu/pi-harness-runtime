/**
 * What Pi itself does with a failed turn.
 *
 * The extension API of the installed core does not report the internal
 * retry of Pi, so the harness infers it from the settings of Pi and from
 * the kind of the failure. The suite covers the inference and the read of
 * the settings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	DEFAULT_PI_RETRY_SETTINGS,
	expectsPiRetry,
	piRetriesFailure,
	readPiRetrySettings,
} from "../harness/pi-retry-policy.ts";

test("a rate limit and an overload are the failures that Pi retries", () => {
	assert.equal(piRetriesFailure("rate-limit"), true);
	assert.equal(piRetriesFailure("overload"), true);
});

test("an exhausted plan and a rejected credential are not retried by Pi", () => {
	assert.equal(piRetriesFailure("usage-exhausted"), false);
	assert.equal(piRetriesFailure("credentials"), false);
	assert.equal(piRetriesFailure("unknown"), false);
});

test("a failure is only expected to be retried when the retry of Pi is on", () => {
	const failure = { kind: "rate-limit" };
	assert.equal(expectsPiRetry(failure, DEFAULT_PI_RETRY_SETTINGS), true);
	assert.equal(
		expectsPiRetry(failure, { ...DEFAULT_PI_RETRY_SETTINGS, enabled: false }),
		false,
	);
});

test("a failure that Pi does not retry is never expected to be retried", () => {
	assert.equal(
		expectsPiRetry({ kind: "usage-exhausted" }, DEFAULT_PI_RETRY_SETTINGS),
		false,
	);
});

test("the settings of Pi come from the agent and the project", () => {
	const files = {
		"/agent/settings.json": JSON.stringify({ retry: { enabled: false, maxRetries: 5 } }),
		"/project/.pi/settings.json": JSON.stringify({ retry: { baseDelayMs: 500 } }),
	};
	const settings = readPiRetrySettings({
		agentDir: "/agent",
		cwd: "/project",
		readFile: (path) => files[path],
	});

	assert.equal(settings.enabled, false, "the agent settings decide");
	assert.equal(settings.maxRetries, 5, "the agent settings decide");
	assert.equal(settings.baseDelayMs, 500, "the project overrides the agent");
});

test("the project overrides the agent", () => {
	const files = {
		"/agent/settings.json": JSON.stringify({ retry: { enabled: false } }),
		"/project/.pi/settings.json": JSON.stringify({ retry: { enabled: true } }),
	};
	const settings = readPiRetrySettings({
		agentDir: "/agent",
		cwd: "/project",
		readFile: (path) => files[path],
	});

	assert.equal(settings.enabled, true, "the project wins");
});

test("a missing or broken settings file leaves the defaults of the core", () => {
	const missing = readPiRetrySettings({
		agentDir: "/agent",
		cwd: "/project",
		readFile: () => undefined,
	});
	assert.deepEqual(missing, DEFAULT_PI_RETRY_SETTINGS);

	const broken = readPiRetrySettings({
		agentDir: "/agent",
		cwd: "/project",
		readFile: () => "{not json",
	});
	assert.deepEqual(broken, DEFAULT_PI_RETRY_SETTINGS);
});
