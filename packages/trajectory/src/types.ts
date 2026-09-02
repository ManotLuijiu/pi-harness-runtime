/**
 * Trajectory types — structured write-review cycle records for learning.
 *
 * Each completed loop cycle produces one Trajectory entry. These are persisted
 * to `~/.pi-harness/trajectories/` as newline-delimited JSON (NDJSON), one
 * record per line. Simple, append-only, and grep-friendly.
 */

// Note: Verdict/Comment types imported in store.ts from write-review

export interface Comment {
	file?: string;
	comment: string;
	severity: "minor" | "major" | "critical";
}

/** A completed write-review loop cycle. */
export interface Trajectory {
	/** Stable UUID — generated at cycle start, persisted in state. */
	id: string;
	/** Original user request that triggered the loop. */
	taskRequest: string;
	/** ISO-8601 timestamp when the cycle started. */
	createdAt: string;
	/** Wall-clock duration in milliseconds. */
	durationMs: number;
	/** Number of write-review rounds completed. */
	iterations: number;
	/** Final verdict from the GPT reviewer. */
	verdict: "approved" | "blocked" | "changes_requested";
	/** Human-readable termination reason (from finishNode). */
	reason: string;
	/** Plan produced by the GPT planner. */
	plan: string;
	/** Final code output from the MiniMax coder. */
	code: string;
	/** Files mentioned in comments across all review iterations. */
	files: string[];
	/** All comments from the final review iteration. */
	comments: Comment[];
	/** Final review summary. */
	summary: string;
	/** Whether this trajectory was used for training/classification. */
	classified: boolean;
}

/** Lightweight summary for list/aggregate queries. */
export interface TrajectorySummary {
	id: string;
	taskRequest: string;
	createdAt: string;
	durationMs: number;
	iterations: number;
	verdict: Trajectory["verdict"];
	reason: string;
	files: string[];
	classified: boolean;
}

/** Classification label applied by the trajectory classifier. */
export type TrajectoryLabel = "converged" | "stuck" | "blocked" | "max-iterations";

/** Classification result for a trajectory. */
export interface TrajectoryClassification {
	trajectoryId: string;
	label: TrajectoryLabel;
	confidence: number; // 0–1
	pattern?: string; // e.g. "same-file-repeated"
	recommendation: string;
}

/** Aggregated statistics across a set of trajectories. */
export interface TrajectoryStats {
	total: number;
	byVerdict: Record<Trajectory["verdict"], number>;
	byLabel: Record<TrajectoryLabel, number>;
	avgIterations: number;
	avgDurationMs: number;
	byFile: Record<string, number>; // file → comment count
}
