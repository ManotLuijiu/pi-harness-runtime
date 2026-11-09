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
	piRetriesErrorText,
	piRetriesFailure,
	piRetryOutcome,
	readPiRetrySettings,
} from "../harness/pi-retry-policy.ts";

/**
 * The payload of a MiniMax 2067: the plan of the account is exhausted.
 *
 * The payload carries the type `rate_limit_error`, so the predicate of Pi
 * retries it - and a retry delay is what the user can cancel.
 */
const PAYLOAD_2067 = [
	'{"type":"error","error":{"type":"rate_limit_error","code":2067,',
	'"message":"The Token Plan usage limit has been reached. Please upgrade',
	'your plan or buy credits to continue using the model. (2067)"}}',
].join("\n");

test("a rate limit and an overload are the failures that Pi retries", () => {
	assert.equal(piRetriesFailure("rate-limit"), true);
	assert.equal(piRetriesFailure("overload"), true);
});

test("the categories that usually match the predicate of Pi", () => {
	assert.equal(piRetriesFailure("usage-exhausted"), false);
	assert.equal(piRetriesFailure("credentials"), false);
	assert.equal(piRetriesFailure("unknown"), false);
});

test("the predicate of Pi decides, not the category of the harness", () => {
	// The category of the harness calls this an exhausted plan, but the
	// payload carries the type `rate_limit_error`, so Pi retries it and the
	// user can cancel that delay.
	assert.equal(piRetriesFailure("usage-exhausted"), false);
	assert.equal(piRetriesErrorText(PAYLOAD_2067), true);
	assert.equal(
		piRetriesErrorText(`API error 429: ${PAYLOAD_2067}`),
		true,
		"the status of the response is part of the text",
	);
});

test("an error that Pi does not retry is not retried", () => {
	assert.equal(piRetriesErrorText("invalid api key (401)"), false);
	assert.equal(piRetriesErrorText("insufficient_quota: quota exceeded"), false);
	assert.equal(piRetriesErrorText(""), false);
	assert.equal(piRetriesErrorText(undefined), false);
});

test("an error is only expected to be retried when the retry of Pi is on", () => {
	const text = "429 Too Many Requests";
	assert.equal(expectsPiRetry(DEFAULT_PI_RETRY_SETTINGS, text), true);
	assert.equal(
		expectsPiRetry({ ...DEFAULT_PI_RETRY_SETTINGS, enabled: false }, text),
		false,
	);
});

test("an error that Pi does not retry is never expected to be retried", () => {
	assert.equal(
		expectsPiRetry(DEFAULT_PI_RETRY_SETTINGS, "invalid api key (401)"),
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
	const text = "429 Too Many Requests";
	assert.equal(piRetryOutcome(DEFAULT_PI_RETRY_SETTINGS, 1, text), "cancelled");
	assert.equal(piRetryOutcome(DEFAULT_PI_RETRY_SETTINGS, 2, text), "cancelled");
	assert.equal(piRetryOutcome(DEFAULT_PI_RETRY_SETTINGS, 3, text), "cancelled");
	assert.equal(piRetryOutcome(DEFAULT_PI_RETRY_SETTINGS, 4, text), "budget-spent");
});

test("a run that stopped before the budget of Pi was cancelled", () => {
	// The user pressed Escape during the delay after the second failure:
	// Pi made two attempts and its budget allows four.
	const text = "429 Too Many Requests";
	assert.equal(piRetryOutcome(DEFAULT_PI_RETRY_SETTINGS, 2, text), "cancelled");
});

test("a cancelled delay of an exhausted plan is a cancellation too", () => {
	// The 2067 is retried by Pi, so the user can cancel that delay.
	assert.equal(piRetryOutcome(DEFAULT_PI_RETRY_SETTINGS, 1, PAYLOAD_2067), "cancelled");
	assert.equal(piRetryOutcome(DEFAULT_PI_RETRY_SETTINGS, 2, PAYLOAD_2067), "cancelled");
	assert.equal(piRetryOutcome(DEFAULT_PI_RETRY_SETTINGS, 4, PAYLOAD_2067), "budget-spent");
});

test("a budget of zero retries is a spent budget, not a cancellation", () => {
	// Pi settles right after the first failure, so there was never a delay
	// that the user could have cancelled.
	const settings = { ...DEFAULT_PI_RETRY_SETTINGS, maxRetries: 0 };
	assert.equal(piRetryOutcome(settings, 1, "429 Too Many Requests"), "budget-spent");
});

test("an error that Pi does not retry is never a cancellation", () => {
	assert.equal(
		piRetryOutcome(DEFAULT_PI_RETRY_SETTINGS, 1, "invalid api key (401)"),
		"not-retried",
	);
	assert.equal(
		piRetryOutcome({ ...DEFAULT_PI_RETRY_SETTINGS, enabled: false }, 1, "429 Too Many Requests"),
		"not-retried",
	);
});
