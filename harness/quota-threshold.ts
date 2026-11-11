/**
 * The threshold of the low-allowance policy.
 *
 * The console of a provider shows the percentage that is left ("5h: 0%
 * left"), the mirror of the harness stores the percentage that is used.
 * The two are complements, and the policy is stated in the remaining
 * percentage, so the conversion and the thresholds live here and are used
 * by name.
 *
 * The module is pure: it decides, it does not observe. The capture of the
 * quota, the freshness of the capture and the scheduling of the recovery
 * belong to the modules around it.
 */

/** The remaining percentage below which the allowance of a window is low. */
export const LOW_REMAINING_THRESHOLD_PCT = 10;

/**
 * A reset that is nearer than this is left to the bounded recovery cycle.
 *
 * The cycle of a failure waits 1, 4, 9 and 16 minutes. A reset that
 * arrives within the hour is reached by that cycle, and spending the
 * budget of the cycle on a reset that is about to happen would leave
 * nothing for the failure that comes next.
 */
export const RESET_HORIZON_MS = 60 * 60_000;

/** The remaining percentage of a used percentage. */
export function remainingPctFromUsedPct(usedPct: number): number {
	return 100 - usedPct;
}

/** The used percentage of a remaining percentage. */
export function usedPctFromRemainingPct(remainingPct: number): number {
	return 100 - remainingPct;
}

/** The state of one quota window. */
export type QuotaWindowState =
	/** Nothing is known about the window. */
	| "unknown"
	/** The window still has its allowance. */
	| "available"
	/** The window is below the threshold, but not empty. */
	| "low"
	/** The window is empty. */
	| "exhausted";

/**
 * The state of a window, read from its used percentage.
 *
 * An unknown percentage is unknown and nothing else: it is not an empty
 * window and it is not a window with an allowance.
 */
export function quotaWindowState(
	usedPct: number | undefined | null,
): QuotaWindowState {
	if (typeof usedPct !== "number" || !Number.isFinite(usedPct)) {
		return "unknown";
	}
	const remaining = remainingPctFromUsedPct(usedPct);
	if (remaining <= 0) return "exhausted";
	if (remaining < LOW_REMAINING_THRESHOLD_PCT) return "low";
	return "available";
}

/** Is the window below the threshold (nearly empty or empty)? */
export function isBelowLowThreshold(
	usedPct: number | undefined | null,
): boolean {
	const state = quotaWindowState(usedPct);
	return state === "low" || state === "exhausted";
}

/** Is the window completely empty? */
export function isFullyExhausted(
	usedPct: number | undefined | null,
): boolean {
	return quotaWindowState(usedPct) === "exhausted";
}

/** The decision of the policy for one window. */
export type QuotaResetDecision =
	/** Wait for the reset of the window. */
	| "reset"
	/** Keep the bounded recovery cycle. */
	| "bounded";

/**
 * Decide what one window means for a failed request.
 *
 * An empty window blocks the account until it resets, whatever the
 * distance of the reset is: the bounded cycle cannot help, because every
 * attempt of the cycle fails the same way.
 *
 * A window that is nearly empty blocks the account as well, but a reset
 * that arrives within the hour is reached by the cycle, so the cycle
 * keeps the failure.
 */
export function decideQuotaReset(input: {
	usedPct: number | undefined | null;
	resetAt: number | undefined | null;
	now: number;
}): QuotaResetDecision {
	const state = quotaWindowState(input.usedPct);
	if (state !== "exhausted" && state !== "low") return "bounded";
	const resetAt = input.resetAt;
	if (
		typeof resetAt !== "number" ||
		!Number.isFinite(resetAt) ||
		resetAt <= input.now
	) {
		return "bounded";
	}
	if (state === "exhausted") return "reset";
	return resetAt - input.now > RESET_HORIZON_MS ? "reset" : "bounded";
}
