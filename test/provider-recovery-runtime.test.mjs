/**
 * The runtime of the automatic resumes after a provider failure.
 *
 * The clock and the timers are injected, so every deadline in this suite is
 * exact and no test waits for real time. The suite covers the three
 * defects of the runtime:
 *
 * - a pause of the user wins over a scheduled retry,
 * - the recovery starts at the settled boundary, after the internal
 *   retries of Pi,
 * - a usage limit that states a deadline keeps it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyProviderFailure } from "../harness/provider-failure.ts";
import { createProviderRecoveryController } from "../harness/provider-recovery.ts";
import {
	ProviderRecoveryRuntime,
	mayDispatchResume,
} from "../harness/provider-recovery-runtime.ts";
import { createPendingActionRegistry } from "../harness/pending-actions.ts";

const MINUTE = 60_000;

/**
 * A clock that owns the timers of the runtime.
 *
 * The timers are only run when the test asks for it, so the suite never
 * waits and the order of the events is exact.
 */
function createFakeClock(start = 1_000_000) {
	let now = start;
	let sequence = 0;
	const timers = new Map();

	const clock = {
		now: () => now,
		setTimeout(callback, delayMs) {
			sequence += 1;
			const handle = sequence;
			timers.set(handle, { callback, at: now + Math.max(0, delayMs) });
			return handle;
		},
		clearTimeout(handle) {
			timers.delete(handle);
		},
		/** Move the clock forward. */
		advance(ms) {
			now += ms;
			return now;
		},
		/** The number of the pending timers. */
		get pendingTimers() {
			return timers.size;
		},
		/** The deadline of the next timer, when there is one. */
		nextDueAt() {
			const deadlines = Array.from(timers.values()).map((timer) => timer.at);
			return deadlines.length > 0 ? Math.min(...deadlines) : null;
		},
		/** Run every timer that is due at the current time. */
		runDue() {
			const due = Array.from(timers.entries()).filter(([, timer]) => timer.at <= now);
			for (const [handle, timer] of due) {
				timers.delete(handle);
				timer.callback();
			}
			return due.length;
		},
		/** Run the next timer, whatever its deadline, and move the clock to it. */
		runNext() {
			const dueAt = clock.nextDueAt();
			if (dueAt === null) return false;
			now = dueAt;
			clock.runDue();
			return true;
		},
	};

	return clock;
}

/**
 * A runtime with a fake clock, a fresh registry and a fresh controller.
 */
function createRuntime(clock, overrides = {}) {
	const actions = createPendingActionRegistry();
	const controller = createProviderRecoveryController({ now: () => clock.now() });
	const dispatched = [];
	const session = {
		id: "s-1",
		explicitlyPaused: false,
		questionPending: false,
		sessionBusy: false,
	};

	const runtime = new ProviderRecoveryRuntime({
		controller,
		actions,
		recoveryActionId: "provider-recovery",
		blockedActionId: "provider-blocked",
		overloadActionId: "provider-overload-resume",
		maxAttempts: 4,
		now: () => clock.now(),
		setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
		clearTimeout: (handle) => clock.clearTimeout(handle),
		context: () => ({
			sessionId: session.id,
			explicitlyPaused: session.explicitlyPaused,
			questionPending: session.questionPending,
			sessionBusy: session.sessionBusy,
		}),
		dispatch: (reason) => {
			dispatched.push(reason);
		},
		...overrides,
	});

	return { runtime, actions, controller, dispatched, session, clock };
}

/** The failure of MiniMax that ran out of its plan. */
const USAGE_LIMIT = "MiniMax usage limit reached (2067)";

/** The failure of a rate limit that states a deadline. */
const RATE_LIMIT_WITH_DEADLINE = "429 Too Many Requests. Retry-After: 120";

/** The failure of an overloaded provider. */
const OVERLOAD = "529 overloaded";

/** The failure of a rejected credential. */
const CREDENTIALS = "401 unauthorized";

test("the pause of the user wins over a scheduled retry", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched, session } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	// The countdown is pending: the row shows the deadline.
	const row = actions.get("provider-recovery");
	assert.ok(row, "the pending attempt has a row");
	assert.equal(row.state, "scheduled");
	assert.equal(row.dueAt, clock.now() + MINUTE);
	assert.equal(dispatched.length, 0);

	// The user pauses the work before the countdown expires.
	session.explicitlyPaused = true;
	clock.advance(MINUTE);
	clock.runDue();

	assert.equal(dispatched.length, 0, "a paused work is not resumed");
	assert.equal(
		actions.get("provider-recovery"),
		null,
		"the row of the attempt leaves with the attempt",
	);
});

test("a resume is skipped when a question waits for the user", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched, session } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	session.questionPending = true;
	clock.advance(MINUTE);
	clock.runDue();

	assert.equal(dispatched.length, 0, "a question wins over the resume");
});

test("a resume of another session is skipped", () => {
	const clock = createFakeClock();
	const { runtime, dispatched, session } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	// The session changed: the resume of the previous session belongs to
	// nobody.
	session.id = "s-2";
	clock.advance(MINUTE);
	clock.runDue();

	assert.equal(dispatched.length, 0, "a resume of another session is skipped");
});

test("a resume is skipped while a request of the user is running", () => {
	const clock = createFakeClock();
	const { runtime, dispatched, session } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	// The user resumed by hand and the request is still running: the
	// queued messages are empty, because Pi already picked the message up.
	session.sessionBusy = true;
	clock.advance(MINUTE);
	clock.runDue();

	assert.equal(
		dispatched.length,
		0,
		"a running request of the user is not resumed on top of it",
	);
});

test("a cancellation followed by another failure schedules a new attempt", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	const first = actions.get("provider-recovery");
	assert.ok(first, "the first attempt is pending");
	assert.equal(first.dueAt, clock.now() + MINUTE);

	// The user resumes by hand after ten seconds: the countdown is
	// cancelled.
	clock.advance(10_000);
	runtime.cancelPending();

	// The request of the user fails before the old deadline.
	clock.advance(20_000);
	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-2",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	const second = actions.get("provider-recovery");
	assert.ok(second, "the new failure schedules its own attempt");
	assert.notEqual(
		second.dueAt,
		first.dueAt,
		"the cancelled deadline does not own the new attempt",
	);
	assert.equal(second.dueAt, clock.now() + MINUTE);

	clock.advance(MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 1, "the recovery resumes the turn");
});

test("a manual request cancels the pending attempt of the cycle", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	assert.ok(actions.get("provider-recovery"), "the attempt is pending");

	// The user types a message: the pending attempt is cancelled.
	runtime.cancelPending();

	assert.equal(
		actions.get("provider-recovery"),
		null,
		"the row of the cancelled attempt leaves",
	);
	assert.equal(clock.pendingTimers, 0, "the countdown stops");

	clock.advance(MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0, "the cancelled attempt never runs");
});

test("a resume runs when nothing took over", () => {
	const clock = createFakeClock();
	const { runtime, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	clock.advance(MINUTE);
	clock.runDue();

	assert.deepEqual(dispatched, ["provider-recovery"]);
});

test("the recovery starts after the internal retries of Pi", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	// The failed attempt is reported, but Pi retries the turn internally
	// first: the internal retries take ten minutes.
	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);

	assert.equal(
		actions.get("provider-recovery"),
		null,
		"nothing is scheduled while the internal retries may still succeed",
	);
	assert.equal(clock.pendingTimers, 0, "no timer runs during the internal retries");

	clock.advance(10 * MINUTE);
	runtime.noteSettled();

	const row = actions.get("provider-recovery");
	assert.ok(row, "the recovery starts at the settled boundary");
	assert.equal(
		row.dueAt,
		clock.now() + MINUTE,
		"the wait starts when the run settles, not when the attempt failed",
	);

	clock.advance(MINUTE);
	clock.runDue();
	assert.deepEqual(dispatched, ["provider-recovery"]);
});

test("a usage limit that states a deadline keeps it", () => {
	const clock = createFakeClock();
	const { runtime, actions } = createRuntime(clock);

	const failure = classifyProviderFailure(
		"MiniMax usage limit reached (2067). Retry-After: 600",
	);
	assert.equal(failure.kind, "usage-exhausted");
	assert.equal(failure.retryAfterMs, 600_000, "the stated deadline survives");

	runtime.noteFailure(failure, "turn-1", {
		provider: "minimax",
		boundedEligible: true,
	});
	runtime.noteSettled();

	const row = actions.get("provider-recovery");
	assert.ok(row);
	assert.equal(
		row.dueAt,
		clock.now() + 600_000,
		"the stated deadline is the deadline of the attempt",
	);
});

test("a usage limit without a deadline waits one minute", () => {
	const clock = createFakeClock();
	const { runtime, actions } = createRuntime(clock);

	const failure = classifyProviderFailure(USAGE_LIMIT);
	assert.equal(failure.retryAfterMs, undefined);

	runtime.noteFailure(failure, "turn-1", {
		provider: "minimax",
		boundedEligible: true,
	});
	runtime.noteSettled();

	const row = actions.get("provider-recovery");
	assert.ok(row);
	assert.equal(row.dueAt, clock.now() + MINUTE);
});

test("a rate limit that states a deadline keeps it too", () => {
	const clock = createFakeClock();
	const { runtime, actions } = createRuntime(clock);

	const failure = classifyProviderFailure(RATE_LIMIT_WITH_DEADLINE);
	assert.equal(failure.kind, "rate-limit");
	assert.equal(failure.retryAfterMs, 120_000);

	runtime.noteFailure(failure, "turn-1", {
		provider: "minimax",
		boundedEligible: true,
	});
	runtime.noteSettled();

	const row = actions.get("provider-recovery");
	assert.ok(row);
	assert.equal(row.dueAt, clock.now() + 120_000);
});

test("the decision about a dispatch names the reason", () => {
	const base = {
		scheduledSessionId: "s-1",
		current: {
			sessionId: "s-1",
			explicitlyPaused: false,
			questionPending: false,
			sessionBusy: false,
		},
	};

	assert.equal(mayDispatchResume(base).allowed, true);

	const paused = mayDispatchResume({
		...base,
		current: { ...base.current, explicitlyPaused: true },
	});
	assert.equal(paused.allowed, false);
	assert.match(paused.reason, /paused/);

	const waiting = mayDispatchResume({
		...base,
		current: { ...base.current, questionPending: true },
	});
	assert.equal(waiting.allowed, false);
	assert.match(waiting.reason, /question/);

	const other = mayDispatchResume({
		...base,
		current: { ...base.current, sessionId: "s-2" },
	});
	assert.equal(other.allowed, false);
	assert.match(other.reason, /session/);

	const busy = mayDispatchResume({
		...base,
		current: { ...base.current, sessionBusy: true },
	});
	assert.equal(busy.allowed, false);
	assert.match(busy.reason, /busy/);
});

test("an overload keeps its own executor and never joins the cycle", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock, {
		overloadDelayMs: () => 2 * MINUTE,
	});

	runtime.noteFailure(
		classifyProviderFailure(OVERLOAD),
		"turn-1",
		{ provider: "minimax", overloadEligible: true, boundedEligible: false },
	);
	runtime.noteSettled();

	assert.equal(
		actions.get("provider-recovery"),
		null,
		"the overload does not join the cycle",
	);
	const overload = actions.get("provider-overload-resume");
	assert.ok(overload, "the overload has its own row");
	assert.equal(overload.dueAt, clock.now() + 2 * MINUTE);

	clock.advance(2 * MINUTE);
	clock.runDue();
	assert.deepEqual(dispatched, ["provider-overload"]);
});

test("a failure without an executor schedules nothing", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(CREDENTIALS),
		"turn-1",
		{ provider: "minimax", boundedEligible: false, overloadEligible: false },
	);
	runtime.noteSettled();

	assert.equal(actions.get("provider-recovery"), null);
	assert.equal(actions.get("provider-overload-resume"), null);
	assert.equal(clock.pendingTimers, 0, "no timer runs without an executor");

	clock.advance(30 * MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0);
});

test("a user intervention cancels the pending resumes", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();
	assert.equal(clock.pendingTimers, 1);

	runtime.cancel();

	assert.equal(clock.pendingTimers, 0, "the timer of the attempt is cancelled");
	assert.equal(actions.get("provider-recovery"), null);

	clock.advance(MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0, "a cancelled attempt never runs");
});

test("a successful turn ends the cycle and clears the pending resumes", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	runtime.noteSuccess("minimax");

	assert.equal(clock.pendingTimers, 0);
	assert.equal(actions.get("provider-recovery"), null);

	clock.advance(MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0);
});

test("a successful turn without a known provider ends the pending resumes", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	runtime.noteSuccess(undefined);

	assert.equal(clock.pendingTimers, 0);
	assert.equal(actions.get("provider-recovery"), null);

	clock.advance(MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0);
});

test("the session end cancels every pending resume", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);
	runtime.noteSettled();

	runtime.reset();

	assert.equal(clock.pendingTimers, 0);
	assert.equal(actions.get("provider-recovery"), null);

	clock.advance(MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0);
});

test("a retry of Pi that the user cancelled leaves no recovery behind", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	// Pi would retry the failure, and it never made the attempt: the user
	// cancelled the delay of the retry.
	runtime.noteFailure(
		classifyProviderFailure(RATE_LIMIT_WITH_DEADLINE),
		"turn-1",
		{
			provider: "minimax",
			boundedEligible: true,
			piRetryOutcome: "cancelled",
		},
	);
	runtime.noteSettled();

	assert.equal(
		actions.get("provider-recovery"),
		null,
		"a cancelled retry schedules no attempt",
	);
	assert.equal(clock.pendingTimers, 0, "a cancelled retry starts no timer");

	clock.advance(MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0, "the user keeps the turn");
});

test("the recovery starts when Pi made the retry attempt", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(RATE_LIMIT_WITH_DEADLINE),
		"turn-1",
		{
			provider: "minimax",
			boundedEligible: true,
			piRetryOutcome: "budget-spent",
		},
	);
	runtime.noteSettled();

	const row = actions.get("provider-recovery");
	assert.ok(row, "the attempt of the cycle is scheduled");
	// The rate limit states a deadline of two minutes: the deadline of the
	// attempt is the later of the two.
	assert.equal(row.dueAt, clock.now() + 120_000);

	clock.advance(120_000);
	clock.runDue();
	assert.equal(dispatched.length, 1, "the exhausted retry of Pi hands over to the cycle");
});

test("a failure that Pi does not retry starts the recovery", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	// An exhausted plan has no retry delay of Pi, so there is nothing the
	// user could have cancelled.
	runtime.noteFailure(
		classifyProviderFailure(USAGE_LIMIT),
		"turn-1",
		{
			provider: "minimax",
			boundedEligible: true,
			piRetryOutcome: "not-retried",
		},
	);
	runtime.noteSettled();

	assert.ok(actions.get("provider-recovery"), "the attempt of the cycle is scheduled");

	clock.advance(MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 1, "the cycle resumes the turn");
});

test("a cancelled retry of Pi silences the overload executor too", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(OVERLOAD),
		"turn-1",
		{
			provider: "minimax",
			overloadEligible: true,
			piRetryOutcome: "cancelled",
		},
	);
	runtime.noteSettled();

	assert.equal(actions.get("provider-overload-resume"), null);
	assert.equal(clock.pendingTimers, 0);
	assert.equal(dispatched.length, 0);
});

test("an aborted run clears the candidate before the run settles", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	runtime.noteFailure(
		classifyProviderFailure(RATE_LIMIT_WITH_DEADLINE),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);

	// The user aborts the run before it settles.
	runtime.cancel();

	// The run settles after the abort.
	runtime.noteSettled();

	assert.equal(actions.get("provider-recovery"), null, "no attempt is scheduled");
	assert.equal(clock.pendingTimers, 0, "no timer is started");

	clock.advance(5 * MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0, "the user keeps the turn");
});

test("a permanent failure clears the candidate of an earlier failure", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock);

	// A rate limit arms the candidate.
	runtime.noteFailure(
		classifyProviderFailure(RATE_LIMIT_WITH_DEADLINE),
		"turn-1",
		{ provider: "minimax", boundedEligible: true },
	);

	// A credential error follows in the same run: no retry can fix it, and
	// it supersedes the retry of the rate limit.
	runtime.noteFailure(classifyProviderFailure(CREDENTIALS), "turn-2", {
		provider: "minimax",
	});
	runtime.cancelPending();

	runtime.noteSettled();

	assert.equal(actions.get("provider-recovery"), null, "no attempt is scheduled");
	assert.equal(clock.pendingTimers, 0, "no timer is started");

	clock.advance(5 * MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0, "a permanent failure schedules no resume");
});
