/**
 * @pi-harness/trajectory
 *
 * Trajectory capture for the write-review loop.
 * Persists completed cycle records to `~/.pi-harness/trajectories/` for learning.
 *
 * Inspired by Hermes Agent's closed learning loop.
 * See: wiki/ROADMAP.md § M7
 */

export {
 TrajectoryStore,
 getTrajectoryStore,
} from "./store.js";
export {
 ApprovedPatternStore,
 getApprovedPatternStore,
 resetApprovedPatternStore,
} from "./approved-patterns.js";
export type {
 Trajectory,
 TrajectorySummary,
 TrajectoryStats,
 TrajectoryClassification,
 TrajectoryLabel,
} from "./types.js";
