/**
 * The alert of a low allowance.
 *
 * An allowance that falls below ten percent is worth a message: the human
 * can act before the window is empty. The message is sent once per
 * crossing: a capture of the same state again is not a new crossing, and
 * an allowance that recovers arms the alert again.
 *
 * The alert is not a decision and not a recovery: it needs no approval
 * and it costs no attempt of the recovery cycle.
 */

import {
	LOW_REMAINING_THRESHOLD_PCT,
	quotaWindowState,
} from "./quota-threshold.ts";

/** What the tracker says about an observation. */
export type QuotaAlertDecision =
	/** The allowance is below the threshold and the alert was not sent yet. */
	| "notify"
	/** The allowance is below the threshold and the alert was sent already. */
	| "silent"
	/** The allowance recovered; the alert is armed again. */
	| "rearmed"
	/** Nothing is known about the allowance. */
	| "none";

/**
 * The state of the alert, per provider.
 *
 * The tracker remembers the providers whose alert was sent. The state is
 * the state of the allowance, not of the capture: a capture that says
 * nothing does not arm the alert again.
 */
export class QuotaLowRemainingTracker {
	private readonly thresholdPct: number;
	private readonly alerted = new Set<string>();

	constructor(thresholdPct: number = LOW_REMAINING_THRESHOLD_PCT) {
		this.thresholdPct = thresholdPct;
	}

	/**
	 * Observe the used percentage of the five-hour window of a provider.
	 *
	 * The percentage is the used percentage of the mirror: the allowance
	 * that is left is its complement.
	 */
	observe(
		provider: string,
		usedPct: number | undefined | null,
	): QuotaAlertDecision {
		const key = provider.toLowerCase();
		const state = quotaWindowState(usedPct);
		if (state === "unknown") return "none";
		if (state === "available") {
			// The allowance recovered: the next crossing alerts again.
			return this.alerted.delete(key) ? "rearmed" : "none";
		}
		if (this.alerted.has(key)) return "silent";
		this.alerted.add(key);
		return "notify";
	}

	/** Was the alert sent for this provider? */
	isAlerted(provider: string): boolean {
		return this.alerted.has(provider.toLowerCase());
	}

	/** The threshold of the alert, in percent of the remaining allowance. */
	get threshold(): number {
		return this.thresholdPct;
	}
}
