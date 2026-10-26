/**
 * Task Graph — RFC-0016 (DAG) with the RFC-0028 compact view.
 *
 * There is one implementation and one API. The concrete RFC-0016 graph owns
 * the dependency tracking, the status transitions, the retry state, the
 * persistence and the topological order. RFC-0028 only added a
 * compact-priority view on top of a task list, so that view is adapted onto
 * the concrete task nodes here instead of living in a second, incompatible
 * implementation.
 *
 * A task is READY only when all of its dependencies are DONE.
 */

import type {
	TaskGraph,
	TaskNode,
	TaskStatus,
} from "../packages/types/dist/runtime-types.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Write a JSON file, creating the parent directory when needed.
 *
 * The two helpers below are local on purpose: this module is loaded by the
 * node test suite, and node resolves a module path literally. A cross
 * directory import would either need the compiled ".js" convention (which
 * node cannot map back to a TypeScript source) or a ".ts" specifier (which
 * the compiler rejects unless a project opts into it).
 */
function writeJsonFile(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

/** Read a JSON file. Returns null when it is missing or unreadable. */
function readJsonFile(path: string): unknown | null {
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

export interface TaskGraphOptions {
	jobId: string;
	rootDir?: string;
}

/**
 * A task that is added to the graph.
 *
 * `status` is optional. When it is missing the status is derived from the
 * dependencies: a task without dependencies is READY, a task with
 * dependencies waits in PENDING until they are done.
 */
export interface TaskDescription {
	id: string;
	title: string;
	description: string;
	status?: TaskStatus;
	dependencies?: string[];
	acceptanceCriteria?: string[];
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
	 * Wrap an existing graph, for example a planned graph or a loaded one.
	 * The manager then works on that graph instead of an empty one.
	 */
	static fromGraph(graph: TaskGraph): TaskGraphManager {
		const manager = new TaskGraphManager({ jobId: graph.jobId });
		manager.graph = graph;
		return manager;
	}

	/**
	 * Add a task node to the graph.
	 *
	 * Both call forms are supported: the planner describes a task by its
	 * parts, and the runtime hands over a task object it already holds.
	 */
	addTask(task: TaskDescription): TaskNode;
	addTask(
		id: string,
		title: string,
		description: string,
		dependencies?: string[],
		acceptanceCriteria?: string[],
	): TaskNode;
	addTask(
		taskOrId: TaskDescription | string,
		title?: string,
		description?: string,
		dependencies: string[] = [],
		acceptanceCriteria?: string[],
	): TaskNode {
		const spec: TaskDescription =
			typeof taskOrId === "string"
				? {
						id: taskOrId,
						title: title ?? "",
						description: description ?? "",
						dependencies,
						acceptanceCriteria,
					}
				: taskOrId;

		const id = spec.id;
		if (this.graph.nodes[id]) {
			throw new Error(`Task ${id} already exists`);
		}

		const deps = spec.dependencies ?? [];

		// Validate dependencies exist
		for (const depId of deps) {
			if (!this.graph.nodes[depId] && depId !== id) {
				console.warn(
					`Warning: dependency ${depId} does not exist yet (task ${id})`,
				);
			}
		}

		const now = new Date().toISOString();
		const node: TaskNode = {
			id,
			title: spec.title,
			description: spec.description,
			status: spec.status ?? (deps.length === 0 ? "ready" : "pending"),
			dependencies: deps,
			dependents: [],
			acceptanceCriteria: spec.acceptanceCriteria,
			retryCount: 0,
			maxRetries: 3,
			createdAt: now,
			updatedAt: now,
		};

		// Update dependents of dependencies
		for (const depId of deps) {
			const dependency = this.graph.nodes[depId];
			if (dependency && !dependency.dependents.includes(id)) {
				dependency.dependents.push(id);
			}
		}

		this.graph.nodes[id] = node;

		// A task may name a dependency before that dependency is added. Now
		// that the dependency is here, the waiting task becomes its dependent.
		for (const other of Object.values(this.graph.nodes)) {
			if (
				other.id !== id &&
				other.dependencies.includes(id) &&
				!node.dependents.includes(other.id)
			) {
				node.dependents.push(other.id);
			}
		}
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
	 * Mark a task as done and update the tasks that wait for it.
	 */
	completeTask(taskId: string): TaskNode | null {
		return this.updateTaskStatus(taskId, "done");
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
	 * Get the blocked tasks.
	 *
	 * Without an argument this returns every task that still waits for a
	 * dependency. With a task id it returns the tasks that wait for that
	 * task: once the task is done, nothing is blocked by it any more.
	 */
	getBlockedTasks(taskId?: string): TaskNode[] {
		if (taskId === undefined) {
			return Object.values(this.graph.nodes).filter(
				(node) => node.status === "pending" || node.status === "blocked",
			);
		}
		const node = this.graph.nodes[taskId];
		if (!node || node.status === "done") return [];
		return node.dependents
			.map((id) => this.graph.nodes[id])
			.filter((n): n is TaskNode => n !== undefined && n.status !== "done");
	}

	/**
	 * Get all tasks that still wait for a dependency.
	 */
	getPendingTasks(): TaskNode[] {
		return Object.values(this.graph.nodes).filter((n) => n.status === "pending");
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
	 * Get compact priority: the task ids to keep in the context and the
	 * task ids that can be pruned from it.
	 */
	getCompactPriority(): {
		keep: string[];
		prune: string[];
	} {
		const tasks = Object.values(this.graph.nodes);
		return {
			keep: tasks.filter((t) => t.status === "done").map((t) => t.id),
			prune: tasks.filter((t) => t.status === "pending").map((t) => t.id),
		};
	}

	/**
	 * Save graph to file
	 */
	async save(rootDir: string): Promise<void> {
		const path = join(rootDir, "jobs", this.graph.jobId, "task-graph.json");
		writeJsonFile(path, this.graph);
		this.dirty = false;
	}

	/**
	 * Load graph from file
	 */
	static async load(jobId: string, rootDir: string): Promise<TaskGraphManager> {
		const path = join(rootDir, "jobs", jobId, "task-graph.json");
		const data = readJsonFile(path) as TaskGraph | null;

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

		// Initialize in-degrees. A dependency that is not in the graph yet
		// does not hold a task back: the order is recomputed when it arrives.
		for (const id of Object.keys(nodes)) {
			inDegree[id] = nodes[id].dependencies.filter(
				(depId) => nodes[depId] !== undefined,
			).length;
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

/**
 * Create a task graph manager. The job id is optional for the callers that
 * only keep the graph in memory.
 */
export function createTaskGraphManager(
	options: Partial<TaskGraphOptions> = {},
): TaskGraphManager {
	return new TaskGraphManager({ jobId: options.jobId ?? "" });
}
