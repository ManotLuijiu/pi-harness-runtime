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
export function createTaskGraphManager(): TaskGraphManager {
	const nodes = new Map<string, TaskNode>();

	return {
		addTask(task: RuntimeTask) {
			if (!nodes.has(task.id)) {
				nodes.set(task.id, {
					task,
					dependencies: new Set(),
					dependents: new Set(),
					status: "pending",
				});
			}
		},

		completeTask(taskId: string) {
			const node = nodes.get(taskId);
			if (!node) return;

			node.status = "done";

			// Update dependents to ready
			for (const depId of node.dependents) {
				const depNode = nodes.get(depId);
				if (!depNode) continue;

				// Check if all dependencies are met
				const allDepsMet = [...depNode.dependencies].every(
					(depId) => nodes.get(depId)?.status === "done",
				);
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

		getBlockedTasks(_taskId: string) {
			// Stub: return empty array
			return [];
		},

		getPendingTasks() {
			return [...nodes.values()]
				.filter((n) => n.status === "pending")
				.map((n) => n.task);
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
