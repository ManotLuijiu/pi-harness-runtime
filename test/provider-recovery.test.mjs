/**
 * The bounded recovery of a provider that rejects a request.
 *
 * The clock is injected, so every deadline in this suite is exact. The
 * assertions are about the policy of wiki section F: the quadratic waits,
 * the four-attempt budget, the duplicate prevention, and the lower bounds
 * that the evidence may impose.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	createProviderRecoveryController,
	MAX_RECOVERY_ATTEMPTS,
	quadraticRecoveryDelayMs,
	RESET_BUFFER_MS,
} from "../harness/provider-recovery.ts";

const MINUTE = 60_000;

/** A cycle of one provider in one session. */
function cycleKey(overrides = {}) {
	return {
		sessionId: "s-1",
		provider: "MiniMax",
		kind: "usage-exhausted",
		...overrides,
	};
}

/** The failure of one interrupted turn. */
function failure(overrides = {}) {
	return {
		failureKey: "turn-1",
		sessionId: "s-1",
		provider: "MiniMax",
		kind: "usage-exhausted",
		...overrides,
	};
}

test("the waits between the attempts are quadratic", () => {
	assert.equal(quadraticRecoveryDelayMs(1), 1 * MINUTE);
	assert.equal(quadraticRecoveryDelayMs(2), 4 * MINUTE);
	assert.equal(quadraticRecoveryDelayMs(3), 9 * MINUTE);
	assert.equal(quadraticRecoveryDelayMs(4), 16 * MINUTE);
});

test("the first attempt waits one minute", () => {
	const now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });

	const outcome = controller.noteFailure(failure());

	assert.equal(outcome.outcome, "scheduled");
	assert.equal(outcome.attempt, 1);
	assert.equal(outcome.dueAt, now + 1 * MINUTE);
	assert.equal(outcome.delayMs, 1 * MINUTE);
	assert.equal(outcome.boundBy, "policy");
});

test("the attempts wait 1, 4, 9 and 16 minutes after the failure that caused them", () => {
	let now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });
	const waits = [];

	for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
		const outcome = controller.noteFailure(failure({ failureKey: `turn-${attempt}` }));
		assert.equal(outcome.outcome, "scheduled");
		assert.equal(outcome.attempt, attempt);
		waits.push(outcome.delayMs);
		// The attempt runs: the next failure is seen after it failed.
		now = outcome.dueAt;
	}

	assert.deepEqual(waits, [1 * MINUTE, 4 * MINUTE, 9 * MINUTE, 16 * MINUTE]);
});

test("the nominal cumulative waiting time is 1, 5, 14 and 30 minutes", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });
	const cumulative = [];

	for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
		const outcome = controller.noteFailure(failure({ failureKey: `turn-${attempt}` }));
		assert.equal(outcome.outcome, "scheduled");
		now = outcome.dueAt;
		cumulative.push(now);
	}

	assert.deepEqual(
		cumulative.map((value) => value / MINUTE),
		[1, 5, 14, 30],
	);
});

test("the fourth failure blocks: no fifth attempt is scheduled", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });

	for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
		const outcome = controller.noteFailure(failure({ failureKey: `turn-${attempt}` }));
		assert.equal(outcome.outcome, "scheduled");
		now = outcome.dueAt;
	}

	const blocked = controller.noteFailure(failure({ failureKey: "turn-5" }));
	assert.equal(blocked.outcome, "blocked");
	assert.equal(blocked.attempt, MAX_RECOVERY_ATTEMPTS);

	// A blocked cycle stays blocked: a later failure does not restart it.
	const again = controller.noteFailure(failure({ failureKey: "turn-6" }));
	assert.equal(again.outcome, "blocked");
});

test("a repeated copy of the same error does not reschedule the attempt", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });

	const first = controller.noteFailure(failure());
	assert.equal(first.outcome, "scheduled");

	// The same error arrives again while the attempt is pending.
	const duplicate = controller.noteFailure(failure());
	assert.equal(duplicate.outcome, "already-scheduled");
	assert.equal(duplicate.attempt, 1);
	assert.equal(duplicate.dueAt, first.dueAt, "the deadline does not move");
});

test("a repeated copy of the same error does not reset the counter", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });

	const first = controller.noteFailure(failure());
	now = first.dueAt;

	// The very same failure again, after the attempt ran.
	const duplicate = controller.noteFailure(failure());
	assert.equal(duplicate.outcome, "duplicate");
	assert.equal(duplicate.attempt, 1, "the counter stays where it is");

	// A new failure advances the cycle to the second attempt.
	const second = controller.noteFailure(failure({ failureKey: "turn-2" }));
	assert.equal(second.outcome, "scheduled");
	assert.equal(second.attempt, 2);
	assert.equal(second.delayMs, 4 * MINUTE);
});

test("an invalidated deadline lets the next failure schedule its own attempt", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });

	const first = controller.noteFailure(failure());
	assert.equal(first.outcome, "scheduled");
	assert.equal(first.attempt, 1);

	// The countdown is cancelled before its deadline: nobody waits for it
	// anymore, so it must not own the next attempt.
	now = 10_000;
	controller.invalidatePending({ sessionId: "s-1" });

	const second = controller.noteFailure(failure({ failureKey: "turn-2" }));
	assert.equal(second.outcome, "scheduled", "the new failure schedules its own attempt");
	assert.equal(
		second.attempt,
		1,
		"the cancelled attempt never ran, so it is not an attempt of the budget",
	);
	assert.equal(second.dueAt, now + MINUTE);
});

test("an attempt that ran keeps its place in the budget", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });

	const first = controller.noteFailure(failure());

	// The attempt ran: its deadline is in the past.
	now = first.dueAt;
	controller.invalidatePending({ sessionId: "s-1" });

	const second = controller.noteFailure(failure({ failureKey: "turn-2" }));
	assert.equal(second.attempt, 2, "the attempt that ran is an attempt of the budget");
	assert.equal(second.delayMs, 4 * MINUTE);
});

test("a successful turn resets the cycle", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });

	const first = controller.noteFailure(failure());
	now = first.dueAt;
	controller.noteSuccess(cycleKey());

	// The next failure starts a new cycle with the first attempt.
	const next = controller.noteFailure(failure({ failureKey: "turn-2" }));
	assert.equal(next.outcome, "scheduled");
	assert.equal(next.attempt, 1);
	assert.equal(next.delayMs, 1 * MINUTE);
});

test("a cancellation ends the cycle", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });

	controller.noteFailure(failure());
	controller.cancel(cycleKey());

	const next = controller.noteFailure(failure({ failureKey: "turn-2" }));
	assert.equal(next.outcome, "scheduled");
	assert.equal(next.attempt, 1);
});

test("an applicable reset is the floor of the deadline", () => {
	const now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });

	const outcome = controller.noteFailure(
		failure({ window: "h5" }),
		{
			provider: "MiniMax",
			window: "h5",
			resetAt: now + 5 * MINUTE,
			observedAt: now - 60_000,
			source: "scrape",
		},
	);

	assert.equal(outcome.outcome, "scheduled");
	assert.equal(outcome.dueAt, now + 5 * MINUTE + RESET_BUFFER_MS);
	assert.equal(outcome.boundBy, "reset");
});

test("the identity of the provider is normalized, so a reset still applies", () => {
	const now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });

	// The cycle keys its provider in lower case, and the provider writes
	// its own name. The comparison has to normalize the two spellings, or
	// the evidence of a reset is discarded for a difference of case alone.
	const outcome = controller.noteFailure(
		failure({ provider: "minimax", window: "h5" }),
		{
			provider: "MiniMax",
			window: "h5",
			resetAt: now + 5 * MINUTE,
			observedAt: now - 60_000,
			source: "scrape",
		},
	);

	assert.equal(outcome.outcome, "scheduled");
	assert.equal(outcome.dueAt, now + 5 * MINUTE + RESET_BUFFER_MS);
	assert.equal(outcome.boundBy, "reset");
});

test("a reset of another window is not a floor", () => {
	const now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });

	const outcome = controller.noteFailure(
		failure({ window: "h5" }),
		{
			provider: "MiniMax",
			window: "weekly",
			resetAt: now + 5 * MINUTE,
			observedAt: now,
		},
	);

	assert.equal(outcome.outcome, "scheduled");
	assert.equal(outcome.dueAt, now + 1 * MINUTE, "the policy decides the deadline");
	assert.equal(outcome.boundBy, "policy");
});

test("a stale reset is not a floor", () => {
	const now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });

	const outcome = controller.noteFailure(
		failure({ window: "h5" }),
		{
			provider: "MiniMax",
			window: "h5",
			resetAt: now + 5 * MINUTE,
			observedAt: now - 60 * MINUTE,
		},
	);

	assert.equal(outcome.outcome, "scheduled");
	assert.equal(outcome.dueAt, now + 1 * MINUTE, "a stale reset never sets a deadline");
});

test("a reset of another provider is not a floor", () => {
	const now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });

	const outcome = controller.noteFailure(
		failure({ window: "h5" }),
		{
			provider: "GLM",
			window: "h5",
			resetAt: now + 5 * MINUTE,
			observedAt: now,
		},
	);

	assert.equal(outcome.outcome, "scheduled");
	assert.equal(outcome.dueAt, now + 1 * MINUTE);
});

test("a failure without a window has no reset floor", () => {
	const now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });

	// The MiniMax Token Plan message names no window: the display of the
	// five-hour window says nothing about that limit.
	const outcome = controller.noteFailure(
		failure(),
		{
			provider: "MiniMax",
			window: "h5",
			resetAt: now + 5 * MINUTE,
			observedAt: now,
		},
	);

	assert.equal(outcome.outcome, "scheduled");
	assert.equal(outcome.dueAt, now + 1 * MINUTE);
	assert.equal(outcome.boundBy, "policy");
});

test("an applicable Retry-After is the floor of the deadline", () => {
	const now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });

	const outcome = controller.noteFailure(
		failure({ retryAfterAt: now + 3 * MINUTE }),
	);

	assert.equal(outcome.outcome, "scheduled");
	assert.equal(outcome.dueAt, now + 3 * MINUTE);
	assert.equal(outcome.boundBy, "retry-after");
});

test("a Retry-After in the past does not shorten the deadline", () => {
	const now = 1_000_000;
	const controller = createProviderRecoveryController({ now: () => now });

	const outcome = controller.noteFailure(
		failure({ retryAfterAt: now - 5 * MINUTE }),
	);

	assert.equal(outcome.outcome, "scheduled");
	assert.equal(outcome.dueAt, now + 1 * MINUTE);
	assert.equal(outcome.boundBy, "policy");
});

test("the deadline of a later attempt is measured from the failure that caused it", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });

	const first = controller.noteFailure(failure());
	now = first.dueAt;
	// The attempt ran and the request took time before it failed.
	now += 30_000;

	const second = controller.noteFailure(failure({ failureKey: "turn-2" }));
	assert.equal(second.outcome, "scheduled");
	assert.equal(second.attempt, 2);
	assert.equal(
		second.dueAt,
		now + 4 * MINUTE,
		"the wait starts after the failure that caused it",
	);
});

test("the state of a cycle is readable", () => {
	let now = 0;
	const controller = createProviderRecoveryController({ now: () => now });

	assert.equal(controller.cycle(cycleKey()), null);

	const outcome = controller.noteFailure(failure());
	const state = controller.cycle(cycleKey());
	assert.equal(state.attempt, 1);
	assert.equal(state.dueAt, outcome.dueAt);
	assert.equal(state.exhausted, false);
});
