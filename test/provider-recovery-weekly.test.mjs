/**
 * The empty weekly allowance of a provider.
 *
 * The suite covers the three facts of the decision: the work stops and
 * waits for the human, the ordinary reset never schedules itself over it,
 * and the count down of the human waits for the reset plus the buffer of
 * the quota service.
 *
 * The clock and the timers are injected, so every deadline of this suite
 * is exact and no test waits for real time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyProviderFailure } from "../harness/provider-failure.ts";
import { createProviderRecoveryController } from "../harness/provider-recovery.ts";
import { ProviderRecoveryRuntime } from "../harness/provider-recovery-runtime.ts";
import { createPendingActionRegistry } from "../harness/pending-actions.ts";
import { confirmedQuotaReset } from "../harness/provider-quota-reset.ts";
import { weeklyQuotaExhausted } from "../harness/weekly-quota-exhaustion.ts";

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * A clock that owns the timers of the runtime.
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
		/** Run every timer that is due at the current time. */
		runDue() {
			const due = Array.from(timers.entries()).filter(
				([, timer]) => timer.at <= now,
			);
			for (const [handle, timer] of due) {
				timers.delete(handle);
				timer.callback();
			}
			return due.length;
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

/** The failure of an overloaded provider. */
const OVERLOAD = "529 overloaded";

/**
 * The evidence of an empty weekly allowance.
 */
function exhaustionAt(clock, offset = 2 * DAY) {
	return {
		provider: "minimax",
		resetAt: clock.now() + offset,
		observedAt: clock.now(),
		remainingPct: 0,
		source: "scrape",
	};
}

function automaticQuotaRuntime(clock, fields) {
	const row = {
		provider: "minimax", source: "scrape", synced_at: new Date(clock.now()).toISOString(),
		h5_used_pct: 21, weekly_used_pct: 25, ...fields,
	};
	const scheduled = [];
	const humanQuestions = [];
	return {
		...createRuntime(clock, {
			automaticWeeklyReset: true,
			quotaResetBufferMs: 0,
			weeklyExhaustionEvidence: (failure, provider) => weeklyQuotaExhausted({ failure, provider, mirror: row, now: clock.now() }),
			quotaResetEvidence: (failure, provider) => confirmedQuotaReset(failure, provider, row, clock.now()),
			onWeeklyExhaustion: (value) => humanQuestions.push(value),
			onQuotaResetScheduled: (evidence, dueAt) => scheduled.push({ evidence, dueAt }),
		}),
		scheduled, humanQuestions,
	};
}

test("captured weekly 0% schedules the reported reset without a human answer or short retry", () => {
	const clock = createFakeClock();
	const resetAt = clock.now() + DAY + 28 * MINUTE;
	const { runtime, actions, dispatched, humanQuestions, scheduled } = automaticQuotaRuntime(clock, {
		weekly_used_pct: 100, weekly_resets_at_epoch: resetAt,
	});
	runtime.noteFailure(classifyProviderFailure('Error: 429 "The Token Plan Usage limit has been reached."'), "weekly-429", { provider: "minimax", boundedEligible: true });
	runtime.noteSettled();
	assert.equal(actions.get("provider-recovery")?.dueAt, resetAt);
	assert.equal(actions.get("provider-blocked"), null);
	assert.equal(clock.pendingTimers, 1);
	assert.equal(humanQuestions.length, 0);
	assert.equal(scheduled.length, 1);
	clock.advance(DAY + 27 * MINUTE); clock.runDue();
	assert.deepEqual(dispatched, []);
	clock.advance(MINUTE); clock.runDue();
	assert.deepEqual(dispatched, ["provider-recovery"]);
});

test("captured five-hour 0% counts down exactly to its reset", () => {
	const clock = createFakeClock();
	const resetAt = clock.now() + 28 * MINUTE;
	const { runtime, actions, dispatched } = automaticQuotaRuntime(clock, { h5_used_pct: 100, h5_resets_at_epoch: resetAt });
	runtime.noteFailure(classifyProviderFailure(USAGE_LIMIT), "h5", { provider: "minimax", boundedEligible: true });
	runtime.noteSettled();
	assert.equal(actions.get("provider-recovery")?.dueAt, resetAt);
	clock.advance(27 * MINUTE); clock.runDue(); assert.deepEqual(dispatched, []);
	clock.advance(MINUTE); clock.runDue(); assert.deepEqual(dispatched, ["provider-recovery"]);
});

test("both exhausted windows wait for the later reset and duplicate errors keep one countdown", () => {
	const clock = createFakeClock();
	const resetAt = clock.now() + DAY;
	const { runtime, actions, scheduled } = automaticQuotaRuntime(clock, {
		h5_used_pct: 100, h5_resets_at_epoch: resetAt,
		weekly_used_pct: 100, weekly_resets_at_epoch: clock.now() + 10 * MINUTE,
	});
	for (const id of ["first", "second"]) {
		runtime.noteFailure(classifyProviderFailure(USAGE_LIMIT), id, { provider: "minimax", boundedEligible: true });
		runtime.noteSettled();
	}
	assert.equal(actions.get("provider-recovery")?.dueAt, resetAt);
	assert.equal(clock.pendingTimers, 1);
	assert.equal(scheduled.length, 1);
});

test("automatic quota countdown still respects a pause and a pending human question", () => {
	for (const guard of ["explicitlyPaused", "questionPending"]) {
		const clock = createFakeClock();
		const { runtime, session, dispatched } = automaticQuotaRuntime(clock, { h5_used_pct: 100, h5_resets_at_epoch: clock.now() + 5 * MINUTE });
		runtime.noteFailure(classifyProviderFailure(USAGE_LIMIT), "quota", { provider: "minimax", boundedEligible: true });
		runtime.noteSettled();
		session[guard] = true;
		clock.advance(5 * MINUTE); clock.runDue();
		assert.deepEqual(dispatched, []);
	}
});

test("an empty weekly allowance blocks the work and waits for the human", () => {
	const clock = createFakeClock();
	const notified = [];
	const { runtime, actions, dispatched } = createRuntime(clock, {
		weeklyExhaustionEvidence: () => exhaustionAt(clock),
		onWeeklyExhaustion: (exhaustion) => notified.push(exhaustion),
	});

	runtime.noteFailure(classifyProviderFailure(USAGE_LIMIT), "week", {
		provider: "minimax",
		boundedEligible: true,
	});
	runtime.noteSettled();

	assert.equal(notified.length, 1, "the human is asked");
	const row = actions.get("provider-blocked");
	assert.equal(row.state, "blocked");
	assert.match(row.reason, /weekly quota exhausted/);
	assert.equal(clock.pendingTimers, 0, "nothing is scheduled without the human");

	clock.advance(3 * DAY);
	clock.runDue();
	assert.equal(dispatched.length, 0, "the silence of the human keeps the work paused");
});

test("the empty week is asked before the ordinary reset is scheduled", () => {
	const clock = createFakeClock();
	const { runtime, actions } = createRuntime(clock, {
		quotaResetEvidence: () => ({
			provider: "minimax",
			window: "h5",
			resetAt: clock.now() + 102 * MINUTE,
			observedAt: clock.now(),
		}),
		weeklyExhaustionEvidence: () => exhaustionAt(clock),
	});

	runtime.noteFailure(classifyProviderFailure(USAGE_LIMIT), "week", {
		provider: "minimax",
		boundedEligible: true,
	});
	runtime.noteSettled();

	assert.equal(actions.get("provider-recovery"), null, "no reset is scheduled");
	assert.equal(actions.get("provider-blocked").state, "blocked");
});

test("the count down of the human waits for the reset and the buffer", () => {
	const clock = createFakeClock();
	const resetAt = clock.now() + 2 * DAY;
	const { runtime, actions, dispatched } = createRuntime(clock, {
		weeklyExhaustionEvidence: () => exhaustionAt(clock),
	});

	runtime.noteFailure(classifyProviderFailure(USAGE_LIMIT), "week", {
		provider: "minimax",
		boundedEligible: true,
	});
	runtime.noteSettled();

	assert.equal(runtime.scheduleWeeklyReset(resetAt, "minimax"), true);
	const row = actions.get("provider-recovery");
	assert.equal(row.dueAt, resetAt + 10 * MINUTE, "the buffer is additive");
	assert.equal(actions.get("provider-blocked"), null, "the blocked row is gone");

	clock.advance(2 * DAY + 9 * MINUTE);
	clock.runDue();
	assert.equal(dispatched.length, 0, "the buffer is waited for");
	clock.advance(MINUTE);
	clock.runDue();
	assert.deepEqual(dispatched, ["provider-recovery"]);
});

test("the human who handles the account keeps the work paused", () => {
	const clock = createFakeClock();
	const { runtime, actions, dispatched } = createRuntime(clock, {
		weeklyExhaustionEvidence: () => exhaustionAt(clock),
	});

	runtime.noteFailure(classifyProviderFailure(USAGE_LIMIT), "week", {
		provider: "minimax",
		boundedEligible: true,
	});
	runtime.noteSettled();

	assert.equal(clock.pendingTimers, 0, "no countdown without the human");
	assert.equal(actions.get("provider-blocked").state, "blocked");

	clock.advance(3 * DAY);
	clock.runDue();
	assert.equal(dispatched.length, 0);
});

test("the compaction that fails with an overload shares the executor of the overload", () => {
	const clock = createFakeClock();
	const { runtime, dispatched } = createRuntime(clock, {
		overloadDelayMs: () => MINUTE,
		overloadMaxAttempts: 100,
	});

	runtime.noteFailure(classifyProviderFailure(OVERLOAD), "turn-1", {
		provider: "anthropic",
		overloadEligible: true,
	});
	runtime.noteSettled();
	assert.equal(clock.pendingTimers, 1, "the turn arms the countdown of the overload");

	// The compaction fails with the same overload: the same executor, one
	// countdown and one budget.
	assert.equal(runtime.scheduleOverloadResume(), true);
	assert.equal(clock.pendingTimers, 1, "there is never a second countdown");
	assert.equal(runtime.overloadAttemptCount, 2, "the budget of the overload is shared");

	clock.advance(MINUTE);
	clock.runDue();
	assert.deepEqual(dispatched, ["provider-overload"], "one resume, not two");
});

test("the budget of the overload is a hundred attempts", () => {
	const clock = createFakeClock();
	const { runtime } = createRuntime(clock, {
		overloadDelayMs: () => MINUTE,
		overloadMaxAttempts: 100,
	});
	for (let attempt = 1; attempt <= 100; attempt += 1) {
		assert.equal(runtime.scheduleOverloadResume(), true, `attempt ${attempt}`);
	}
	assert.equal(runtime.scheduleOverloadResume(), false, "the budget is spent");
	assert.equal(runtime.overloadAttemptCount, 100);
});
