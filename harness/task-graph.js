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
/**
 * Creates a new TaskGraphManager instance.
 * Stub implementation — returns minimal working graph.
 */
export function createTaskGraphManager() {
    const nodes = new Map();
    return {
        addTask(task) {
            if (!nodes.has(task.id)) {
                nodes.set(task.id, {
                    task,
                    dependencies: new Set(),
                    dependents: new Set(),
                    status: "pending",
                });
            }
        },
        completeTask(taskId) {
            const node = nodes.get(taskId);
            if (!node)
                return;
            node.status = "done";
            // Update dependents to ready
            for (const depId of node.dependents) {
                const depNode = nodes.get(depId);
                if (!depNode)
                    continue;
                // Check if all dependencies are met
                const allDepsMet = [...depNode.dependencies].every((depId) => nodes.get(depId)?.status === "done");
                if (allDepsMet) {
                    depNode.status = "ready";
                }
            }
        },
        getReadyTasks() {
            return [...nodes.values()]
                .filter((n) => n.status === "ready")
                .map((n) => n.task);
        },
        getBlockedTasks(_taskId) {
            // Stub: return empty array
            return [];
        },
        getPendingTasks() {
            return [...nodes.values()]
                .filter((n) => n.status === "pending")
                .map((n) => n.task);
        },
        getAllTasks() {
            return [...nodes.values()].map((n) => n.task);
        },
        getProgressSummary() {
            const allNodes = [...nodes.values()];
            return {
                total: allNodes.length,
                done: allNodes.filter((n) => n.status === "done").length,
                running: allNodes.filter((n) => n.status === "running").length,
                failed: allNodes.filter((n) => n.status === "blocked").length,
            };
        },
        getCompactPriority() {
            // Stub: keep done tasks, prune pending ones
            const done = [...nodes.values()]
                .filter((n) => n.status === "done")
                .map((n) => n.task.id);
            const pending = [...nodes.values()]
                .filter((n) => n.status === "pending")
                .map((n) => n.task.id);
            return {
                keep: done, // Keep done task context (they're relevant)
                prune: pending, // Prune pending task messages first
            };
        },
    };
}
