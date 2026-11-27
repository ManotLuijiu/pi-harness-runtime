/**
 * The gate of the recovery of a repeated output.
 *
 * A run that repeats itself is stopped, and the request it belongs to
 * gets one bounded recovery. The decision is a pure function: the session
 * reads the facts of the session and asks this module what may happen.
 *
 * The gate is deliberately narrow. A recovery is a message that sends the
 * agent back into its work, and a message that goes to the wrong work is
 * worse than no message at all. So the recovery is refused when:
 *
 * - no repetition was found,
 * - the human replaced the request that repeated itself,
 * - the recovery was already tried and the repetition came back,
 * - the work is paused,
 * - a question of the human is open and waits for an answer,
 * - the budget of the validation is spent,
 * - the work of the request is complete.
 *
 * The repetition that came back is read before the facts that refuse the
 * recovery: the last one is the blocked state, and the loop survives one
 * recovery. A repetition that is only skipped is a repetition that nobody
 * hears of.
 */

/**
 * The state of the work of the request.
 */
export type RepetitionWorkState = "unfinished" | "complete" | "unknown" | "pending";

/**
 * What the gate allows.
 */
export type RepetitionRecoveryAction = "recover" | "block" | "skip";

/**
 * The facts of the session.
 */
export interface RepetitionRecoveryInput {
	/** A repetition was found in the output of the run. */
	detected: boolean;
	/** The recovery was already tried for this run. */
	recoveryTried: boolean;
	/** The request that repeated itself is still the request that runs. */
	requestMatches: boolean;
	/** The work of the request. */
	work: RepetitionWorkState;
	/** The work is paused. */
	paused: boolean;
	/** A question of the human waits for an answer. */
	questionOpen: boolean;
	/** The budget of the validation is spent. */
	budgetSpent: boolean;
}

/**
 * The decision of the gate.
 */
export interface RepetitionRecoveryDecision {
	/** What may happen. */
	action: RepetitionRecoveryAction;
	/** The reason of the decision, for the log and for the report. */
	reason: string;
}

/**
 * The first fact of the session that would refuse the recovery.
 */
function refusalReasonOf(input: RepetitionRecoveryInput): string | undefined {
	if (input.paused) return "the work is paused";
	if (input.questionOpen) return "a question of the human waits for an answer";
	if (input.budgetSpent) return "the budget of the validation is spent";
	if (input.work === "complete") return "the work of the request is complete";
	return undefined;
}

/**
 * The decision of the gate.
 *
 * An unknown state is not a completion: the uncertainty is preserved. A
 * recovery that is refused for an unknown reason is refused for a named
 * reason, and the reason is in the report.
 */
export function decideRepetitionRecovery(
	input: RepetitionRecoveryInput,
): RepetitionRecoveryDecision {
	if (!input.detected) {
		return { action: "skip", reason: "no repetition was found" };
	}
	if (!input.requestMatches) {
		return {
			action: "skip",
			reason: "the request that repeated itself was replaced by a newer request",
		};
	}
	// The repetition that came back after the recovery is read before the
	// facts that would refuse the recovery: the block is the state of the
	// loop, and it is reported even when the work is paused or the budget
	// is spent. A repetition that is only skipped is a repetition that
	// nobody hears of.
	if (input.recoveryTried) {
		// The block is the state of the loop, and the fact that would have
		// refused the recovery is kept in the reason: the human hears
		// both.
		const refusal = refusalReasonOf(input);
		return {
			action: "block",
			reason: refusal
				? `the repetition came back after the recovery (${refusal})`
				: "the repetition came back after the recovery",
		};
	}
	if (input.paused) {
		return { action: "skip", reason: "the work is paused" };
	}
	if (input.questionOpen) {
		return {
			action: "skip",
			reason: "a question of the human waits for an answer",
		};
	}
	if (input.budgetSpent) {
		return {
			action: "skip",
			reason: "the budget of the validation is spent",
		};
	}
	if (input.work === "complete") {
		return {
			action: "skip",
			reason: "the work of the request is complete",
		};
	}
	if (input.work === "pending") {
		// The request waits for the review phase of its workflow: the
		// harness must not recover it into a step that is not the work of
		// the agent.
		return {
			action: "skip",
			reason: "the request waits for the review phase of its workflow",
		};
	}
	return {
		action: "recover",
		reason:
			input.work === "unknown"
				? "the state of the work of the request is unknown and the repetition was stopped"
				: "the request is unfinished and the repetition was stopped",
	};
}
