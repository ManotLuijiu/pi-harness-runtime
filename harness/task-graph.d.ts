/**
 * Task Graph Manager — RFC-0028 Phase 3
 *
 * Manages task dependency graph for compact-aware scheduling.
 * Currently a stub — integrates with CompactOrchestrator for
 * dependency-aware compaction prioritization.
 *
 * Future work:
 * - Track task dependencies (blocking/ready tasks)
 * - Prioritize compaction to keep blocking path messages
 * - Track which tasks depend on which checkpoint artifacts
 */
import type { RuntimeTask } from "../packages/types/src/runtime-types.js";
export interface TaskNode {
    task: RuntimeTask;
    dependencies: Set<string>;
    dependents: Set<string>;
    status: "pending" | "ready" | "running" | "done" | "blocked";
}
export interface TaskGraphManager {
    /** Add a task to the graph */
    addTask(task: RuntimeTask): void;
    /** Mark a task as done and update dependents */
    completeTask(taskId: string): void;
    /** Get tasks ready for execution */
    getReadyTasks(): RuntimeTask[];
    /** Get tasks blocked by a given task */
    getBlockedTasks(taskId: string): RuntimeTask[];
    /** Get all pending tasks */
    getPendingTasks(): RuntimeTask[];
    /** Get all tasks */
    getAllTasks(): RuntimeTask[];
    /** Get current progress summary */
    getProgressSummary(): {
        total: number;
        done: number;
        running: number;
        failed: number;
    };
    /** Get compact priority: tasks to keep in context vs prune */
    getCompactPriority(): {
        keep: string[];
        prune: string[];
    };
}
/**
 * Creates a new TaskGraphManager instance.
 * Stub implementation — returns minimal working graph.
 */
export declare function createTaskGraphManager(): TaskGraphManager;
//# sourceMappingURL=task-graph.d.ts.map