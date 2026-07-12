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
export { SDK_VERSION, isLegacyCheckpoint, } from "./types.js";
// ─── Legacy Exports (for backward compatibility) ──────────────────────
// TODO: Add legacy adapter to maintain backward compatibility
// export { JsonCheckpointManager } from "./legacy.js";
//# sourceMappingURL=index.js.map