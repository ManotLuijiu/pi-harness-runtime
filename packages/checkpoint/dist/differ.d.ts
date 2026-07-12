/**
 * Checkpoint Engine - Differ
 *
 * Calculate state diffs for incremental checkpoints.
 */
import type { RuntimeState, StateDelta } from "./types.js";
export declare class DiffCalculator {
    /**
     * Calculate diff between two states
     */
    calculateDiff(jobId: string, baseVersion: number, targetVersion: number, baseState: RuntimeState, targetState: RuntimeState): StateDelta;
    /**
     * Calculate task deltas
     */
    private calculateTaskDeltas;
    /**
     * Check if two tasks are different
     */
    private tasksAreDifferent;
    /**
     * Calculate checksum for delta
     */
    private calculateChecksum;
    /**
     * Apply delta to base state
     */
    applyDelta(baseState: RuntimeState, delta: StateDelta): RuntimeState;
    /**
     * Apply task deltas to task list
     */
    private applyTaskDeltas;
    /**
     * Reconstruct state from incremental checkpoints
     */
    reconstructState(fullCheckpoint: RuntimeState, deltas: StateDelta[]): Promise<RuntimeState>;
    /**
     * Estimate size of delta vs full checkpoint
     */
    estimateDeltaSavings(fullSize: number, baseState: RuntimeState, targetState: RuntimeState): {
        deltaSize: number;
        savingsPercent: number;
    };
}
/**
 * Create a diff calculator
 */
export declare function createDiffCalculator(): DiffCalculator;
//# sourceMappingURL=differ.d.ts.map