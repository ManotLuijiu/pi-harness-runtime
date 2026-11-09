/**
 * The classification of a provider failure.
 *
 * The kind of a failure decides whether an automatic retry may be scheduled
 * at all, so the tests use the payload of the incident and the shapes that
 * must stay apart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	classifyProviderFailure,
	parseFailureCode,
	parseRetryAfterMs,
	unwrapRetryWrapper,
	usesBoundedRecovery,
} from "../harness/provider-failure.ts";

/** The payload of the incident: the plan of the account is exhausted. */
const PAYLOAD_2067 = [
	'{"type":"error","error":{"type":"rate_limit_error","code":2067,',
	'"message":"The Token Plan usage limit has been reached. Please upgrade',
	'your plan or buy credits to continue using the model. (2067)"}}',
].join("\n");

test("the payload of the incident is the exhaustion of the plan", () => {
	const failure = classifyProviderFailure(PAYLOAD_2067);

	assert.notEqual(failure, null, "the payload is a failure");
	assert.equal(failure.kind, "usage-exhausted");
	// The plan of the account is exhausted. That is a bounded recovery
	// case, not a permanent block: the cycle tries four times and then
	// stops. It is never an unlimited retry.
	assert.equal(failure.retryable, true);
	assert.equal(failure.recovery, "bounded-recovery");
	assert.equal(
		failure.retryAfterMs,
		undefined,
		"the payload states no deadline, so none is invented",
	);
	assert.equal(failure.code, "2067");
	assert.equal(failure.provider, "MiniMax");
	assert.match(failure.reason, /usage limit reached/);
	assert.equal(
		failure.window,
		undefined,
		"the message names no window, so no reset of the console applies to it",
	);
});

test("the payload of the incident stays the exhaustion of the plan when it is wrapped", () => {
	const wrapped = `Retry failed after 3 attempts: ${PAYLOAD_2067}`;
	const failure = classifyProviderFailure(wrapped);

	assert.notEqual(failure, null);
	assert.equal(failure.kind, "usage-exhausted");
	assert.equal(failure.retryable, true);
	assert.equal(failure.recovery, "bounded-recovery");
	assert.equal(failure.retryAfterMs, undefined);
});

test("a limit that names a window names it", () => {
	const failure = classifyProviderFailure(
		"Your 5-hour usage limit has been reached for this account",
	);
	assert.equal(failure.kind, "usage-exhausted");
	assert.equal(failure.window, "h5");

	const weekly = classifyProviderFailure(
		"The weekly rate limit has been reached",
	);
	assert.equal(weekly.kind, "rate-limit");
	assert.equal(weekly.window, "weekly");
});

test("the wrapper of a retry is unwrapped", () => {
	const unwrapped = unwrapRetryWrapper(
		"Retry failed after 3 attempts: The Token Plan usage limit has been reached.",
	);
	assert.equal(unwrapped.wrapped, true);
	assert.equal(unwrapped.attempts, 3);
	assert.equal(unwrapped.inner, "The Token Plan usage limit has been reached.");

	const plain = unwrapRetryWrapper("something else");
	assert.equal(plain.wrapped, false);
	assert.equal(plain.attempts, undefined);
	assert.equal(plain.inner, "something else");
});

test("a temporary rate limit with a deadline may be retried", () => {
	const failure = classifyProviderFailure(
		'{"error":{"type":"rate_limit_error","code":429,"message":"Rate limit reached. Retry-After: 30"}}',
	);

	assert.notEqual(failure, null);
	assert.equal(failure.kind, "rate-limit");
	assert.equal(failure.retryable, true);
	assert.equal(failure.recovery, "retry-after");
	assert.equal(failure.retryAfterMs, 30_000);
	assert.equal(failure.code, "429");
});

test("a temporary limit without a deadline has no deadline either", () => {
	const failure = classifyProviderFailure(
		'{"error":{"type":"rate_limit_error","message":"Too many requests"}}',
	);

	assert.notEqual(failure, null);
	assert.equal(failure.kind, "rate-limit");
	assert.equal(failure.retryable, true);
	assert.equal(failure.recovery, "backoff");
	assert.equal(failure.retryAfterMs, undefined);
});

test("the deadline of the evidence is read, and only the stated one", () => {
	assert.equal(parseRetryAfterMs("Retry-After: 45"), 45_000);
	assert.equal(parseRetryAfterMs("retry after 1.5 seconds"), 1_500);
	assert.equal(parseRetryAfterMs("retry after 2 minutes"), 120_000);
	assert.equal(parseRetryAfterMs("no deadline here"), undefined);
});

test("an overload of the provider may be retried", () => {
	const failure = classifyProviderFailure(
		'{"type":"error","error":{"type":"overloaded_error","message":"Overloaded (529)"}}',
	);

	assert.notEqual(failure, null);
	assert.equal(failure.kind, "overload");
	assert.equal(failure.retryable, true);
	assert.equal(failure.recovery, "backoff");
	assert.equal(failure.provider, "Anthropic");
	assert.equal(failure.code, "529");
});

test("the surge of the GLM is an overload", () => {
	const failure = classifyProviderFailure(
		"The system is currently experiencing a peak-hour surge, and the server is temporarily busy. It usually recovers within 1-5 minutes. Please try again shortly (2064)",
	);

	assert.notEqual(failure, null);
	assert.equal(failure.kind, "overload");
	assert.equal(failure.retryable, true);
	assert.equal(failure.recovery, "backoff");
	assert.equal(failure.provider, "GLM");
	assert.equal(failure.code, "2064");
});

test("a rejected credential is not retried", () => {
	const failure = classifyProviderFailure(
		'{"error":{"type":"authentication_error","message":"Invalid API key (401)"}}',
	);

	assert.notEqual(failure, null);
	assert.equal(failure.kind, "credentials");
	assert.equal(failure.retryable, false);
	assert.equal(failure.recovery, "none");
});

test("an unknown failure stays unknown", () => {
	const failure = classifyProviderFailure("Something went wrong on the way.");

	assert.notEqual(failure, null);
	assert.equal(failure.kind, "unknown");
	assert.equal(failure.retryable, false);
	assert.equal(failure.recovery, "none");
});

test("the output limit of the session is not a failure of the provider", () => {
	// The continuation of the output limit owns that case, so the
	// classifier leaves it alone.
	assert.equal(
		classifyProviderFailure("reached the maximum output token limit"),
		null,
	);
	assert.equal(
		classifyProviderFailure("Output limit exceeded for this session"),
		null,
	);
});

test("a text that is not a failure is not a failure", () => {
	assert.equal(classifyProviderFailure("The migration is ready."), null);
	assert.equal(classifyProviderFailure(""), null);
	assert.equal(classifyProviderFailure(undefined), null);
});

test("the code of the evidence is read, and only a code that is one", () => {
	assert.equal(parseFailureCode("the request failed with (2067)"), "2067");
	assert.equal(parseFailureCode("status code 429"), "429");
	assert.equal(parseFailureCode("nothing here"), undefined);
});

test("one failure has one executor", () => {
	// A rate limit belongs to the bounded recovery cycle, with or without a
	// stated deadline: the cycle is the backoff of the harness.
	const rateLimit = classifyProviderFailure("429 Too Many Requests");
	assert.equal(rateLimit.kind, "rate-limit");
	assert.equal(usesBoundedRecovery(rateLimit), true);

	const rateLimitWithDeadline = classifyProviderFailure(
		"HTTP 429 Too Many Requests. Retry-After: 120",
	);
	assert.equal(usesBoundedRecovery(rateLimitWithDeadline), true);

	// The exhaustion of the plan belongs to the cycle as well.
	const exhausted = classifyProviderFailure(
		"MiniMax Token Plan usage limit reached (2067)",
	);
	assert.equal(exhausted.kind, "usage-exhausted");
	assert.equal(usesBoundedRecovery(exhausted), true);

	// An overload keeps its own executor, so it does not enter the cycle.
	// Two executors for one failure would be two resume loops.
	const overload = classifyProviderFailure("Error: overloaded_error (529)");
	assert.equal(overload.kind, "overload");
	assert.equal(usesBoundedRecovery(overload), false);

	const peakHour = classifyProviderFailure("Error: peak-hour surge (2064)");
	assert.equal(peakHour.kind, "overload");
	assert.equal(usesBoundedRecovery(peakHour), false);

	// A rejected credential never recovers by waiting.
	const credentials = classifyProviderFailure("Error: 401 Unauthorized");
	assert.equal(credentials.kind, "credentials");
	assert.equal(usesBoundedRecovery(credentials), false);

	// An unknown failure is not turned into a retry.
	const unknown = classifyProviderFailure("Error: something failed");
	assert.equal(usesBoundedRecovery(unknown), false);
});
