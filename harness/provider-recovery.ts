/**
 * The bounded recovery of a provider that rejects a request.
 *
 * A provider can reject a request around a reset that the harness does not
 * see: the quota row shows a positive allowance, and the request still
 * fails. The work must not be stranded because the client gave up after
 * three short attempts, and it must not be retried forever either.
 *
 * The cycle is therefore finite and explicit:
 *
 * - the waits between the attempts are quadratic: 1, 4, 9 and 16 minutes,
 * - at most four attempts run,
 * - a repeated copy of the same error neither reschedules the pending
 *   attempt nor resets the counter,
 * - a deadline the evidence states (an applicable reset, a `Retry-After`)
 *   is a lower bound of the deadline, never a shorter one,
 * - every deadline is the *next attempt*, never a promised recovery of the
 *   provider.
 *
 * The controller decides the deadlines. It never dispatches anything: the
 * executor that owns the resume stays the only owner of the execution.
 */
import type { ProviderFailureKind } from "./provider-failure.ts";

/**
 * The number of attempts of a recovery cycle.
 *
 * After the fourth attempt fails, the cycle is exhausted: the row shows
 * that no fifth attempt is scheduled.
 */
export const MAX_RECOVERY_ATTEMPTS = 4;

/**
 * The buffer after an applicable reset.
 *
 * A reset that is reached exactly at its second is not usable yet, so the
 * retry waits half a minute more.
 */
export const RESET_BUFFER_MS = 30_000;

/**
 * The age after which a reset observation is stale.
 *
 * A stale observation never sets a deadline: the displayed reset moves, and
 * a moving deadline would postpone the retry forever.
 */
export const MAX_RESET_EVIDENCE_AGE_MS = 30 * 60_000;

/**
 * The wait after the attempt that failed.
 *
 * The sequence is quadratic: 1, 4, 9 and 16 minutes. The nominal cumulative
 * waiting time is therefore 1, 5, 14 and 30 minutes - measured from the
 * first failure, without the time the requests themselves took.
 */
export function quadraticRecoveryDelayMs(attempt: number): number {
	const index = Math.max(1, Math.floor(attempt));
	return index * index * 60_000;
}

/**
 * A reset of the provider that the harness observed.
 *
 * The evidence carries its own identity and its observation time, so a
 * stale or foreign reset cannot become the deadline of a retry.
 */
export interface RecoveryResetEvidence {
	/** The provider the reset belongs to. */
	provider: string;
	/** The window the reset belongs to ("h5", "weekly", ...). */
	window: string;
	/** The epoch ms of the reset. */
	resetAt: number;
	/** The epoch ms of the observation. */
	observedAt: number;
	/** The source of the observation, for the log. */
	source?: string;
}

/**
 * The failure that the recovery cycle reacts to.
 */
export interface RecoveryFailureInput {
	/**
	 * The identity of the failed turn.
	 *
	 * A repeated copy of the same error carries the same identity, so it
	 * cannot start a second cycle.
	 */
	failureKey: string;
	/** The session the failure happened in. */
	sessionId: string;
	/** The provider that rejected the request. */
	provider: string;
	/** The kind of the failure. */
	kind: ProviderFailureKind;
	/** The window the limit belongs to, when the evidence names one. */
	window?: string;
	/** The absolute deadline the evidence states, in epoch ms. */
	retryAfterAt?: number;
}

/**
 * What the cycle decided about a failure.
 */
export type RecoveryOutcome =
	| {
			/** An attempt was scheduled. */
			outcome: "scheduled";
			/** The number of the attempt that will run. */
			attempt: number;
			/** The absolute deadline of the attempt. */
			dueAt: number;
			/** The wait after the failure. */
			delayMs: number;
			/** What decided the deadline. */
			boundBy: "policy" | "reset" | "retry-after";
	  }
	| {
			/** The budget of the cycle is used up. No attempt is scheduled. */
			outcome: "blocked";
			/** The number of attempts that ran. */
			attempt: number;
	  }
	| {
			/** The same error arrived again. The cycle does not move. */
			outcome: "duplicate";
			/** The number of the attempt that is pending or was the last one. */
			attempt: number;
	  }
	| {
			/** An attempt is already pending. No second timer is created. */
			outcome: "already-scheduled";
			/** The number of the pending attempt. */
			attempt: number;
			/** The deadline of the pending attempt. */
			dueAt: number;
	  };

/**
 * The state of a recovery cycle.
 */
export interface RecoveryCycleState {
	/** The session the cycle belongs to. */
	sessionId: string;
	/** The provider the cycle belongs to. */
	provider: string;
	/** The number of the attempt that runs next. */
	attempt: number;
	/** The deadline of the pending attempt. */
	dueAt: number | null;
	/** The identity of the failure the cycle reacted to last. */
	lastFailureKey: string | null;
	/** The moment the first failure of the cycle was seen. */
	startedAt: number;
	/** The cycle has used its budget. */
	exhausted: boolean;
}

/**
 * The options of the controller.
 */
export interface ProviderRecoveryControllerOptions {
	/** The clock of the controller. It is injected, so the tests are exact. */
	now?: () => number;
	/** The age after which a reset observation is stale. */
	maxResetEvidenceAgeMs?: number;
}

/**
 * The controller of the recovery cycles.
 */
export interface ProviderRecoveryController {
	/**
	 * React to a failure of a provider.
	 *
	 * The failure decides the deadline of the next attempt. The controller
	 * never dispatches anything itself.
	 */
	noteFailure(
		input: RecoveryFailureInput,
		resetEvidence?: RecoveryResetEvidence,
	): RecoveryOutcome;
	/** A successful turn ends the cycle and resets its counter. */
	noteSuccess(key: { sessionId: string; provider: string }): void;
	/** A cancellation ends the cycle. */
	cancel(key: { sessionId: string; provider: string }): void;
	/** The state of a cycle, for the status row and the tests. */
	cycle(key: {
		sessionId: string;
		provider: string;
		kind: ProviderFailureKind;
	}): RecoveryCycleState | null;
	/** Remove every cycle. */
	clear(): void;
}

/**
 * The identity of a cycle.
 *
 * The cycle belongs to the session, to the provider and to the kind of the
 * failure. A session change therefore starts a new cycle, and a different
 * provider never shares the counter of another one.
 */
function cycleKey(key: {
	sessionId: string;
	provider: string;
	kind: ProviderFailureKind;
}): string {
	return `${key.sessionId}|${key.provider}|${key.kind}`;
}

/**
 * Create the controller of the recovery cycles.
 */
export function createProviderRecoveryController(
	options: ProviderRecoveryControllerOptions = {},
): ProviderRecoveryController {
	const now = options.now ?? (() => Date.now());
	const maxResetEvidenceAgeMs =
		options.maxResetEvidenceAgeMs ?? MAX_RESET_EVIDENCE_AGE_MS;
	const cycles = new Map<string, RecoveryCycleState>();

	/**
	 * The deadline that the applicable evidence states.
	 *
	 * A reset only counts when it is fresh, when it belongs to the same
	 * provider and to the same window as the failure, and when it lies in
	 * the future. A failure that names no window has no window, so no reset
	 * applies to it.
	 */
	const resetFloor = (
		input: RecoveryFailureInput,
		evidence: RecoveryResetEvidence | undefined,
		failureObservedAt: number,
	): number | undefined => {
		if (!evidence) return undefined;
		if (evidence.provider !== input.provider) return undefined;
		if (!input.window || evidence.window !== input.window) return undefined;
		if (evidence.resetAt <= failureObservedAt) return undefined;
		if (failureObservedAt - evidence.observedAt > maxResetEvidenceAgeMs) return undefined;
		return evidence.resetAt + RESET_BUFFER_MS;
	};

	return {
		noteFailure(
			input: RecoveryFailureInput,
			resetEvidence?: RecoveryResetEvidence,
		): RecoveryOutcome {
			const failureObservedAt = now();
			const key = cycleKey({
				sessionId: input.sessionId,
				provider: input.provider,
				kind: input.kind,
			});
			const cycle = cycles.get(key);

			// An attempt that is still pending owns the next deadline. A
			// second copy of the same error must not create a second timer
			// and must not postpone the deadline.
			if (cycle && cycle.dueAt !== null && cycle.dueAt > failureObservedAt) {
				return {
					outcome: "already-scheduled",
					attempt: cycle.attempt,
					dueAt: cycle.dueAt,
				};
			}
			// The very same failure again: the cycle does not move. The
			// counter of the attempts stays where it is.
			if (cycle && cycle.lastFailureKey === input.failureKey) {
				return { outcome: "duplicate", attempt: cycle.attempt };
			}
			// The budget of the cycle is used up: no fifth attempt.
			if (cycle && cycle.exhausted) {
				return { outcome: "blocked", attempt: cycle.attempt };
			}

			const attempt = (cycle?.attempt ?? 0) + 1;
			if (attempt > MAX_RECOVERY_ATTEMPTS) {
				const exhausted: RecoveryCycleState = {
					sessionId: input.sessionId,
					provider: input.provider,
					attempt: MAX_RECOVERY_ATTEMPTS,
					dueAt: null,
					lastFailureKey: input.failureKey,
					startedAt: cycle?.startedAt ?? failureObservedAt,
					exhausted: true,
				};
				cycles.set(key, exhausted);
				return { outcome: "blocked", attempt: MAX_RECOVERY_ATTEMPTS };
			}

			const delayMs = quadraticRecoveryDelayMs(attempt);
			const policyDueAt = failureObservedAt + delayMs;
			const floor = resetFloor(input, resetEvidence, failureObservedAt);
			const retryAfterDueAt =
				input.retryAfterAt && input.retryAfterAt > failureObservedAt
					? input.retryAfterAt
					: undefined;

			let dueAt = policyDueAt;
			let boundBy: "policy" | "reset" | "retry-after" = "policy";
			if (floor !== undefined && floor > dueAt) {
				dueAt = floor;
				boundBy = "reset";
			}
			if (retryAfterDueAt !== undefined && retryAfterDueAt > dueAt) {
				dueAt = retryAfterDueAt;
				boundBy = "retry-after";
			}

			cycles.set(key, {
				sessionId: input.sessionId,
				provider: input.provider,
				attempt,
				dueAt,
				lastFailureKey: input.failureKey,
				startedAt: cycle?.startedAt ?? failureObservedAt,
				exhausted: false,
			});

			return { outcome: "scheduled", attempt, dueAt, delayMs, boundBy };
		},

		noteSuccess(key): void {
			// A successful turn of the provider ends every cycle of that
			// provider in that session: the counter starts at zero again.
			for (const [id, cycle] of [...cycles.entries()]) {
				if (cycle.sessionId === key.sessionId && cycle.provider === key.provider) {
					cycles.delete(id);
				}
			}
		},

		cancel(key): void {
			for (const [id, cycle] of [...cycles.entries()]) {
				if (cycle.sessionId === key.sessionId && cycle.provider === key.provider) {
					cycles.delete(id);
				}
			}
		},

		cycle(key): RecoveryCycleState | null {
			return cycles.get(cycleKey(key)) ?? null;
		},

		clear(): void {
			cycles.clear();
		},
	};
}
