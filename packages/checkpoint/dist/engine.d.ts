/**
 * Checkpoint Engine - Engine
 *
 * Main checkpoint engine with recovery strategies.
 */
import type { CheckpointEngineConfig, CheckpointMetadata, PruneResult, RecoveryResult, RecoveryStrategy, RuntimeState, StateDelta, VerificationResult } from "./types.js";
export declare class CheckpointEngine {
    private readonly config;
    private readonly storage;
    private readonly differ;
    private lastStates;
    constructor(config: CheckpointEngineConfig);
    /**
     * Get current version for a job
     */
    private getCurrentVersion;
    /**
     * Create metadata for a checkpoint
     */
    private createMetadata;
    /**
     * Save a checkpoint (full or incremental based on config)
     */
    save(jobId: string, state: RuntimeState): Promise<CheckpointMetadata>;
    /**
     * Decide if we should use a full checkpoint
     */
    private shouldUseFullCheckpoint;
    /**
     * Save an incremental checkpoint explicitly
     */
    saveIncremental(jobId: string, delta: StateDelta): Promise<CheckpointMetadata>;
    /**
     * Load the latest state for a job
     */
    load(jobId: string): Promise<RuntimeState | null>;
    /**
     * Load state at specific version
     */
    loadState(jobId: string, version: number): Promise<RuntimeState | null>;
    /**
     * Reconstruct state from incremental checkpoint
     */
    private reconstructFromIncremental;
    /**
     * Recover job state using specified strategy
     */
    recover(jobId: string, strategy: RecoveryStrategy): Promise<RecoveryResult>;
    /**
     * Verify a checkpoint
     */
    verify(jobId: string, version: number): Promise<VerificationResult>;
    /**
     * Prune old checkpoints
     */
    prune(jobId: string, keepCount: number): Promise<PruneResult>;
    /**
     * Get metadata for all checkpoints
     */
    getMetadata(jobId: string): Promise<CheckpointMetadata[]>;
    /**
     * Get cached last state
     */
    getLastState(jobId: string): RuntimeState | undefined;
    /**
     * Delete all checkpoints for a job
     */
    deleteAll(jobId: string): Promise<void>;
}
/**
 * Create a checkpoint engine
 */
export declare function createCheckpointEngine(config?: CheckpointEngineConfig): CheckpointEngine;
//# sourceMappingURL=engine.d.ts.map