/**
 * Checkpoint Engine
 *
 * Enhanced checkpoint system with incremental snapshots, diff-based storage,
 * compression, and intelligent recovery strategies.
 */

// ─── Engine ────────────────────────────────────────────────────────────

export { CheckpointEngine, createCheckpointEngine } from "./engine.js";

// ─── Storage ─────────────────────────────────────────────────────────

export { StorageManager, createStorageManager } from "./storage.js";

// ─── Differ ──────────────────────────────────────────────────────────

export { DiffCalculator, createDiffCalculator } from "./differ.js";

// ─── Types ────────────────────────────────────────────────────────────

export {
	SDK_VERSION,
	type RuntimeState,
	type CheckpointType,
	type CheckpointMetadata,
	type FullCheckpoint,
	type IncrementalCheckpoint,
	type StateDelta,
	type TaskDelta,
	type ContextDiff,
	type ErrorEntry,
	type RecoveryStrategy,
	type RecoveryResult,
	type VerificationResult,
	type PruneResult,
	type CheckpointFile,
	type CheckpointIndex,
	type IndexEntry,
	type CheckpointEvent,
	type EventLogEntry,
	type LegacyCheckpoint,
	isLegacyCheckpoint,
} from "./types.js";

// ─── Legacy Exports (for backward compatibility) ──────────────────────
// TODO: Add legacy adapter to maintain backward compatibility
// export { JsonCheckpointManager } from "./legacy.js";
