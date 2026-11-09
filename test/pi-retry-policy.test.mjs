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
	piAttemptBudget,
	piRetriesFailure,
	piRetryOutcome,
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

test("the budget of Pi counts the first attempt", () => {
	assert.equal(piAttemptBudget(DEFAULT_PI_RETRY_SETTINGS), 4);
	assert.equal(piAttemptBudget({ ...DEFAULT_PI_RETRY_SETTINGS, maxRetries: 0 }), 1);
	assert.equal(piAttemptBudget({ ...DEFAULT_PI_RETRY_SETTINGS, maxRetries: 5 }), 6);
});

test("a run that used the whole budget of Pi hands over to the recovery", () => {
	// Pi makes the first attempt and then three retries: four failures.
	const failure = { kind: "rate-limit" };
	assert.equal(piRetryOutcome(failure, DEFAULT_PI_RETRY_SETTINGS, 1), "cancelled");
	assert.equal(piRetryOutcome(failure, DEFAULT_PI_RETRY_SETTINGS, 2), "cancelled");
	assert.equal(piRetryOutcome(failure, DEFAULT_PI_RETRY_SETTINGS, 3), "cancelled");
	assert.equal(piRetryOutcome(failure, DEFAULT_PI_RETRY_SETTINGS, 4), "budget-spent");
});

test("a run that stopped before the budget of Pi was cancelled", () => {
	// The user pressed Escape during the delay after the second failure:
	// Pi made two attempts and its budget allows four.
	const failure = { kind: "rate-limit" };
	assert.equal(piRetryOutcome(failure, DEFAULT_PI_RETRY_SETTINGS, 2), "cancelled");
});

test("a budget of zero retries is a spent budget, not a cancellation", () => {
	// Pi settles right after the first failure, so there was never a delay
	// that the user could have cancelled.
	const settings = { ...DEFAULT_PI_RETRY_SETTINGS, maxRetries: 0 };
	assert.equal(piRetryOutcome({ kind: "rate-limit" }, settings, 1), "budget-spent");
});

test("a failure that Pi does not retry is never a cancellation", () => {
	assert.equal(
		piRetryOutcome({ kind: "usage-exhausted" }, DEFAULT_PI_RETRY_SETTINGS, 1),
		"not-retried",
	);
	assert.equal(
		piRetryOutcome({ kind: "rate-limit" }, { ...DEFAULT_PI_RETRY_SETTINGS, enabled: false }, 1),
		"not-retried",
	);
});
