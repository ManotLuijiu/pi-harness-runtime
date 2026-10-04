/**
 * TrajectoryStore — persists Trajectory records to `~/.pi-harness/trajectories/`.
 *
 * Format: newline-delimited JSON (NDJSON), one Trajectory per line.
 * - Append-only writes (no locking needed for single-daemon writes)
 * - Grep-friendly for manual inspection
 * - Compact: no document overhead like JSON-array-with-commas
 *
 * File naming: `YYYY-MM/YYYY-MM-DD.ndjson`
 * - Daily rotation keeps files small and manageable
 * - Directory by month for easy archival
 *
 * Directory structure:
 *   ~/.pi-harness/trajectories/
 *     2025-07/
 *       2025-07-14.ndjson
 *       2025-07-15.ndjson
 */
import type { Trajectory, TrajectorySummary, TrajectoryStats, TrajectoryClassification } from "./types.js";
export type { Trajectory, TrajectorySummary, TrajectoryStats, TrajectoryClassification, TrajectoryLabel, } from "./types.js";
/**
 * TrajectoryStore — append-only persistence for write-review cycle records.
 *
 * Usage:
 * ```ts
 * const store = new TrajectoryStore();
 *
 * // At cycle start
 * const id = store.start("fix the login bug");
 *
 * // At cycle finish
 * store.append({
 *   id,
 *   taskRequest: "fix the login bug",
 *   createdAt: new Date(startMs).toISOString(),
 *   durationMs: Date.now() - startMs,
 *   iterations: 2,
 *   verdict: "approved",
 *   reason: "reviewer approved",
 *   plan: "...",
 *   code: "...",
 *   files: ["auth.ts"],
 *   comments: [],
 *   summary: "looks good",
 *   classified: false,
 * });
 * ```
 */
export declare class TrajectoryStore {
    private readonly _trajDir;
    constructor(trajDir?: string);
    /** List all trajectories, newest first. */
    list(): Trajectory[];
    /** Summaries only (lightweight list). */
    listSummaries(): TrajectorySummary[];
    /** Append a completed trajectory record. */
    append(trajectory: Trajectory): void;
    /** Start a new trajectory — returns a UUID for the cycle. */
    start(_request: string): string;
    /** Build aggregate statistics. */
    stats(): TrajectoryStats;
    /** Classify a single trajectory. */
    classify(trajectory: Trajectory): TrajectoryClassification;
    /** Get trajectories by verdict (for training set building). */
    byVerdict(verdict: Trajectory["verdict"]): Trajectory[];
}
export declare function getTrajectoryStore(): TrajectoryStore;
export declare function resetTrajectoryStore(): void;
//# sourceMappingURL=store.d.ts.map