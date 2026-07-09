/**
 * Checkpoint Engine - Differ
 *
 * Calculate state diffs for incremental checkpoints.
 */
import { createHash } from "node:crypto";
// ─── Diff Calculator ─────────────────────────────────────────────────────
export class DiffCalculator {
    /**
     * Calculate diff between two states
     */
    calculateDiff(jobId, baseVersion, targetVersion, baseState, targetState) {
        const changes = {};
        // Check status change
        if (baseState.status !== targetState.status) {
            changes.status = targetState.status;
        }
        // Calculate task changes
        const taskDeltas = this.calculateTaskDeltas(baseState.tasks, targetState.tasks);
        if (taskDeltas.length > 0) {
            changes.tasks = taskDeltas;
        }
        // Check metadata changes
        if (JSON.stringify(baseState.metadata) !==
            JSON.stringify(targetState.metadata)) {
            changes.metadata = targetState.metadata;
        }
        // Check for errors
        if (baseState.lastError !== targetState.lastError) {
            changes.errors = [
                {
                    error: targetState.lastError ?? "",
                    timestamp: targetState.updatedAt,
                    recoverable: targetState.status === "blocked",
                },
            ];
        }
        const timestamp = new Date().toISOString();
        const checksum = this.calculateChecksum(jobId, baseVersion, targetVersion, changes);
        return {
            jobId,
            baseVersion,
            targetVersion,
            changes,
            timestamp,
            checksum,
        };
    }
    /**
     * Calculate task deltas
     */
    calculateTaskDeltas(baseTasks, targetTasks) {
        const deltas = [];
        const baseMap = new Map(baseTasks.map((t) => [t.id, t]));
        const targetMap = new Map(targetTasks.map((t) => [t.id, t]));
        // Find added and updated tasks
        for (const [taskId, targetTask] of targetMap) {
            const baseTask = baseMap.get(taskId);
            if (!baseTask) {
                // Task was added
                deltas.push({
                    taskId,
                    action: "added",
                    after: targetTask,
                });
            }
            else if (this.tasksAreDifferent(baseTask, targetTask)) {
                // Task was updated
                deltas.push({
                    taskId,
                    action: "updated",
                    before: baseTask,
                    after: targetTask,
                });
            }
        }
        // Find removed tasks
        for (const [taskId, baseTask] of baseMap) {
            if (!targetMap.has(taskId)) {
                deltas.push({
                    taskId,
                    action: "removed",
                    before: baseTask,
                });
            }
        }
        return deltas;
    }
    /**
     * Check if two tasks are different
     */
    tasksAreDifferent(a, b) {
        return (a.status !== b.status ||
            a.title !== b.title ||
            a.description !== b.description ||
            a.assignedProvider !== b.assignedProvider ||
            a.worktreePath !== b.worktreePath);
    }
    /**
     * Calculate checksum for delta
     */
    calculateChecksum(jobId, baseVersion, targetVersion, changes) {
        const data = JSON.stringify({
            jobId,
            baseVersion,
            targetVersion,
            changes,
            timestamp: new Date().toISOString(),
        });
        return createHash("sha256").update(data).digest("hex");
    }
    /**
     * Apply delta to base state
     */
    applyDelta(baseState, delta) {
        const result = { ...baseState };
        // Apply status change
        if (delta.changes.status !== undefined) {
            result.status = delta.changes.status;
        }
        // Apply task changes
        if (delta.changes.tasks) {
            result.tasks = this.applyTaskDeltas(baseState.tasks, delta.changes.tasks);
        }
        // Apply metadata changes
        if (delta.changes.metadata !== undefined) {
            result.metadata = delta.changes.metadata;
        }
        // Apply error changes
        if (delta.changes.errors && delta.changes.errors.length > 0) {
            const lastError = delta.changes.errors[delta.changes.errors.length - 1];
            result.lastError = lastError.error;
        }
        // Update version and timestamp
        result.version = delta.targetVersion;
        result.updatedAt = new Date().toISOString();
        return result;
    }
    /**
     * Apply task deltas to task list
     */
    applyTaskDeltas(tasks, taskDeltas) {
        const taskMap = new Map(tasks.map((t) => [t.id, { ...t }]));
        for (const delta of taskDeltas) {
            switch (delta.action) {
                case "added":
                    if (delta.after) {
                        taskMap.set(delta.taskId, delta.after);
                    }
                    break;
                case "updated":
                    if (delta.after) {
                        taskMap.set(delta.taskId, delta.after);
                    }
                    break;
                case "removed":
                    taskMap.delete(delta.taskId);
                    break;
            }
        }
        return Array.from(taskMap.values());
    }
    /**
     * Reconstruct state from incremental checkpoints
     */
    async reconstructState(fullCheckpoint, deltas) {
        // Sort deltas by version
        const sortedDeltas = [...deltas].sort((a, b) => a.targetVersion - b.targetVersion);
        // Apply each delta in order
        let state = fullCheckpoint;
        for (const delta of sortedDeltas) {
            state = this.applyDelta(state, delta);
        }
        return state;
    }
    /**
     * Estimate size of delta vs full checkpoint
     */
    estimateDeltaSavings(fullSize, baseState, targetState) {
        const delta = this.calculateDiff(targetState.jobId, baseState.version, targetState.version, baseState, targetState);
        const deltaJson = JSON.stringify(delta);
        const deltaSize = Buffer.byteLength(deltaJson);
        const savingsPercent = ((fullSize - deltaSize) / fullSize) * 100;
        return {
            deltaSize,
            savingsPercent: Math.max(0, savingsPercent),
        };
    }
}
// ─── Factory Function ────────────────────────────────────────────────────
/**
 * Create a diff calculator
 */
export function createDiffCalculator() {
    return new DiffCalculator();
}
//# sourceMappingURL=differ.js.map