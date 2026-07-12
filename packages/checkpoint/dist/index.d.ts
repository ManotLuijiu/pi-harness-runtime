/**
 * Checkpoint Engine
 *
 * Enhanced checkpoint system with incremental snapshots, diff-based storage,
 * compression, and intelligent recovery strategies.
 */
export { CheckpointEngine, createCheckpointEngine } from "./engine.js";
export { StorageManager, createStorageManager } from "./storage.js";
export { DiffCalculator, createDiffCalculator } from "./differ.js";
export { SDK_VERSION, type RuntimeState, type CheckpointType, type CheckpointMetadata, type FullCheckpoint, type IncrementalCheckpoint, type StateDelta, type TaskDelta, type ContextDiff, type ErrorEntry, type RecoveryStrategy, type RecoveryResult, type VerificationResult, type PruneResult, type CheckpointFile, type CheckpointIndex, type IndexEntry, type CheckpointEvent, type EventLogEntry, type LegacyCheckpoint, isLegacyCheckpoint, } from "./types.js";
//# sourceMappingURL=index.d.ts.map