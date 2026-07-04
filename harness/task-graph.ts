/**
 * Task Graph — RFC-0016
 *
 * DAG-based work representation where tasks are READY only when all
 * dependencies are DONE.
 */

import type {
	TaskNode,
	TaskGraph,
	TaskStatus,
} from "../packages/types/src/runtime-types.ts";
import { writeJson, readJson } from "../cli.ts";
// @ts-expect-error - Bun has built-in Node.js types
import { join } from "node:path";

export interface TaskGraphOptions {
	jobId: string;
	rootDir?: string;
}

export class TaskGraphManager {
	private graph: TaskGraph;
	private dirty = false;

	constructor(options: TaskGraphOptions) {
		this.graph = {
			jobId: options.jobId,
			nodes: {},
			topologicalOrder: [],
		};
	}

	/**
	 * Add a task node to the graph
	 */
	addTask(
		id: string,
		title: string,
		description: string,
		dependencies: string[] = [],
		acceptanceCriteria?: string[],
	): TaskNode {
		if (this.graph.nodes[id]) {
			throw new Error(`Task ${id} already exists`);
		}

		// Validate dependencies exist
		for (const depId of dependencies) {
			if (!this.graph.nodes[depId] && depId !== id) {
				console.warn(
					`Warning: dependency ${depId} does not exist yet (task ${id})`,
				);
			}
		}

		const now = new Date().toISOString();
		const node: TaskNode = {
			id,
			title,
			description,
			status: dependencies.length === 0 ? "ready" : "pending",
			dependencies,
			dependents: [],
			acceptanceCriteria,
			retryCount: 0,
			maxRetries: 3,
			createdAt: now,
			updatedAt: now,
		};

		// Update dependents of dependencies
		for (const depId of dependencies) {
			if (this.graph.nodes[depId]) {
				this.graph.nodes[depId].dependents.push(id);
			}
		}

		this.graph.nodes[id] = node;
		this.recomputeTopologicalOrder();
		this.dirty = true;

		return node;
	}

	/**
	 * Update task status
	 */
	updateTaskStatus(taskId: string, status: TaskStatus): TaskNode | null {
		const node = this.graph.nodes[taskId];
		if (!node) return null;

		node.status = status;
		node.updatedAt = new Date().toISOString();

		// If task is done, check if dependents can now be ready
		if (status === "done") {
			this.updateDependentStatuses(taskId);
		}

		this.recomputeTopologicalOrder();
		this.dirty = true;
		return node;
	}

	/**
	 * Update dependent tasks when a dependency is completed
	 */
	private updateDependentStatuses(completedTaskId: string): void {
		for (const dependentId of this.graph.nodes[completedTaskId]?.dependents ??
			[]) {
			const dependent = this.graph.nodes[dependentId];
			if (!dependent) continue;

			// Check if ALL dependencies are done
			const allDepsDone = dependent.dependencies.every(
				(depId) => this.graph.nodes[depId]?.status === "done",
			);

			if (allDepsDone && dependent.status === "pending") {
				dependent.status = "ready";
				dependent.updatedAt = new Date().toISOString();
			}
		}
	}

	/**
	 * Get all tasks ready for execution (status = "ready")
	 */
	getReadyTasks(): TaskNode[] {
		return Object.values(this.graph.nodes).filter((n) => n.status === "ready");
	}

	/**
	 * Get task by ID
	 */
	getTask(taskId: string): TaskNode | null {
		return this.graph.nodes[taskId] ?? null;
	}

	/**
	 * Get all tasks
	 */
	getAllTasks(): TaskNode[] {
		return Object.values(this.graph.nodes);
	}

	/**
	 * Get topological order of tasks
	 */
	getTopologicalOrder(): string[] {
		return this.graph.topologicalOrder;
	}

	/**
	 * Check if all tasks are done
	 */
	isComplete(): boolean {
		return Object.values(this.graph.nodes).every((n) => n.status === "done");
	}

	/**
	 * Check if there are any failed tasks
	 */
	hasFailedTasks(): boolean {
		return Object.values(this.graph.nodes).some((n) => n.status === "failed");
	}

	/**
	 * Get failed tasks
	 */
	getFailedTasks(): TaskNode[] {
		return Object.values(this.graph.nodes).filter((n) => n.status === "failed");
	}

	/**
	 * Increment retry count for a task
	 */
	incrementRetry(taskId: string): TaskNode | null {
		const node = this.graph.nodes[taskId];
		if (!node) return null;
		node.retryCount = (node.retryCount ?? 0) + 1;
		node.updatedAt = new Date().toISOString();
		this.dirty = true;
		return node;
	}

	/**
	 * Assign agent to task
	 */
	assignAgent(
		taskId: string,
		agentId: string,
		worktreePath?: string,
	): TaskNode | null {
		const node = this.graph.nodes[taskId];
		if (!node) return null;
		node.assignedAgent = agentId;
		if (worktreePath) node.worktreePath = worktreePath;
		node.updatedAt = new Date().toISOString();
		this.dirty = true;
		return node;
	}

	/**
	 * Unassign agent from task
	 */
	unassignAgent(taskId: string): TaskNode | null {
		const node = this.graph.nodes[taskId];
		if (!node) return null;
		node.assignedAgent = undefined;
		node.worktreePath = undefined;
		node.updatedAt = new Date().toISOString();
		this.dirty = true;
		return node;
	}

	/**
	 * Check if task can be retried
	 */
	canRetry(taskId: string): boolean {
		const node = this.graph.nodes[taskId];
		if (!node) return false;
		const retries = node.retryCount ?? 0;
		const max = node.maxRetries ?? 3;
		return retries < max;
	}

	/**
	 * Get progress summary
	 */
	getProgressSummary(): {
		total: number;
		done: number;
		failed: number;
		pending: number;
		running: number;
	} {
		const tasks = Object.values(this.graph.nodes);
		return {
			total: tasks.length,
			done: tasks.filter((t) => t.status === "done").length,
			failed: tasks.filter((t) => t.status === "failed").length,
			pending: tasks.filter(
				(t) => t.status === "pending" || t.status === "ready",
			).length,
			running: tasks.filter(
				(t) =>
					t.status === "running" ||
					t.status === "testing" ||
					t.status === "reviewing",
			).length,
		};
	}

	/**
	 * Save graph to file
	 */
	async save(rootDir: string): Promise<void> {
		const path = join(rootDir, "jobs", this.graph.jobId, "task-graph.json");
		writeJson(path, this.graph);
		this.dirty = false;
	}

	/**
	 * Load graph from file
	 */
	static async load(jobId: string, rootDir: string): Promise<TaskGraphManager> {
		const path = join(rootDir, "jobs", jobId, "task-graph.json");
		const data = readJson(path) as TaskGraph | null;

		const manager = new TaskGraphManager({ jobId });
		if (data?.nodes) {
			manager.graph = data as TaskGraph;
		}

		return manager;
	}

	/**
	 * Check if graph has unsaved changes
	 */
	isDirty(): boolean {
		return this.dirty;
	}

	/**
	 * Get the full graph
	 */
	getGraph(): TaskGraph {
		return this.graph;
	}

	/**
	 * Compute topological order using Kahn's algorithm
	 */
	private recomputeTopologicalOrder(): void {
		const order: string[] = [];
		const inDegree: Record<string, number> = {};
		const nodes = this.graph.nodes;

		// Initialize in-degrees
		for (const id of Object.keys(nodes)) {
			inDegree[id] = nodes[id].dependencies.length;
		}

		// Start with nodes that have no dependencies
		const queue: string[] = [];
		for (const id of Object.keys(nodes)) {
			if (inDegree[id] === 0) {
				queue.push(id);
			}
		}

		while (queue.length > 0) {
			const current = queue.shift()!;
			order.push(current);

			for (const dependent of nodes[current].dependents) {
				inDegree[dependent]--;
				if (inDegree[dependent] === 0) {
					queue.push(dependent);
				}
			}
		}

		// Check for cycles (shouldn't happen with valid input)
		if (order.length !== Object.keys(nodes).length) {
			console.warn(
				"Warning: topological sort detected a cycle in the task graph",
			);
		}

		this.graph.topologicalOrder = order;
	}
}
