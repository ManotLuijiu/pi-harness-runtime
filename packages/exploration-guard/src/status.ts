/**
 * The visibility of the exploration in the status.
 *
 * The status shows what was observed, never what was understood. The
 * numbers describe the reads, and the label says whether a checkpoint is
 * due, whether more investigation was justified, whether the implementation
 * started, or whether a concrete blocker stopped the progress.
 */

import { hasSubstantiveProgress, type Intervention } from "./budget.js";
import type { ExplorationState } from "./types.js";

/**
 * What the exploration is doing.
 *
 * The states are the ones of the handoff: the agent explores, a checkpoint
 * is due, a specific question still needs reading, the evidence is
 * sufficient and the implementation is the next step, or a concrete blocker
 * stopped the progress.
 */
export type ExplorationOutcome =
	| "investigating"
	| "checkpoint-due"
	| "investigate-more"
	| "implementation-started"
	| "blocked";

/**
 * The status of the exploration.
 */
export interface ExplorationStatus {
	/** The label of the exploration. */
	outcome: ExplorationOutcome;
	/** The number of reads that were observed. */
	reads: number;
	/** The number of reads that repeated a range. */
	repeats: number;
	/** True when a checkpoint is due. */
	checkpointDue: boolean;
	/**
	 * True when the guard says that the evidence may be sufficient and the
	 * smallest justified change is the next step.
	 */
	suggestsImplementation: boolean;
	/** The estimated cost of the exploration, when it was observed. */
	estimatedTokens?: number;
	/** True when the estimate is an estimate. */
	estimatedTokensApproximate: boolean;
}

/**
 * The status of the exploration of a request.
 *
 * The status never claims that the agent understood the files it read, and
 * it never presents an estimated token count as a measured one.
 */
export function explorationStatus(
	state: ExplorationState,
	intervention?: Intervention,
): ExplorationStatus {
	const requiresCheckpoint = intervention?.requiresCheckpoint === true;
	const suggestsImplementation = intervention?.suggestsImplementation === true;
	// The implementation is the next step only when the evidence is
	// already recorded. A checkpoint that is still due comes first.
	const hasEvidence = hasSubstantiveProgress(state);
	let outcome: ExplorationOutcome = "investigating";
	if (intervention?.kind === "blocked") outcome = "blocked";
	else if (requiresCheckpoint && suggestsImplementation && hasEvidence) {
		outcome = "implementation-started";
	} else if (requiresCheckpoint) outcome = "checkpoint-due";
	else if (suggestsImplementation && hasEvidence) outcome = "implementation-started";
	else if (state.checkpoint.openQuestions.length > 0) outcome = "investigate-more";
	return {
		outcome,
		reads: state.readCount,
		repeats: state.repeatCount,
		checkpointDue: requiresCheckpoint,
		suggestsImplementation,
		estimatedTokens:
			state.estimatedTokens > 0 ? state.estimatedTokens : undefined,
		estimatedTokensApproximate: state.estimatedTokensApproximate,
	};
}

/**
 * The label of the exploration, as the status line shows it.
 *
 * The format is the compact one of the harness: ASCII, no emoji, and the
 * numbers that describe the observations.
 */
export function formatExplorationStatus(
	status: ExplorationStatus,
): string {
	const parts: string[] = ["investigating"];
	parts.push(`${status.reads} reads`);
	if (status.repeats > 0) parts.push(`${status.repeats} repeats`);
	switch (status.outcome) {
		case "checkpoint-due":
			parts.push("checkpoint due");
			break;
		case "investigate-more":
			parts.push("investigate");
			break;
		case "implementation-started":
			parts.push("implement");
			break;
		case "blocked":
			parts.push("blocked");
			break;
		case "investigating":
			break;
		default:
			break;
	}
	if (status.estimatedTokens !== undefined) {
		const marker = status.estimatedTokensApproximate ? "~" : "";
		parts.push(`${marker}${status.estimatedTokens} tokens`);
	}
	return parts.join(" | ");
}
