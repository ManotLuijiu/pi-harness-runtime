/**
 * Task Compiler - Task Graph Builder
 *
 * Builds the deterministic DAG from compiled tasks,
 * performs topological sort, and detects root/terminal nodes.
 */

import type { CompiledTask, TaskGraph } from "./types.js";

/**
 * Build a TaskGraph from compiled tasks.
 *
 * The graph is built from task dependencies and includes:
 * - Roots: tasks with no incoming dependencies
 * - Terminals: tasks with no outgoing dependencies
 * - Deterministic topological order
 */
export function buildGraph(tasks: CompiledTask[]): TaskGraph {
	const taskMap = new Map<string, CompiledTask>();
	for (const task of tasks) {
		taskMap.set(task.id, task);
	}

	// ─── Compute dependents ────────────────────────────────────────────

	const dependents = new Map<string, string[]>();
	for (const task of tasks) {
		dependents.set(task.id, []);
	}
	for (const task of tasks) {
		for (const depId of task.dependencies) {
			const list = dependents.get(depId);
			if (list) list.push(task.id);
		}
	}

	// ─── Find roots and terminals ─────────────────────────────────────

	const roots = tasks
		.filter((t) => t.dependencies.length === 0)
		.map((t) => t.id);

	const terminals = tasks
		.filter((t) => (dependents.get(t.id)?.length ?? 0) === 0)
		.map((t) => t.id);

	// ─── Deterministic topological sort ────────────────────────────────

	const order = topologicalSort([...tasks], taskMap);

	return {
		jobId: tasks[0]?.jobId ?? "",
		tasks,
		roots,
		terminalTasks: terminals,
		topologicalOrder: order,
	};
}

// ─── Kahn's topological sort with deterministic tiebreaking ─────────────────

function topologicalSort(
	tasks: CompiledTask[],
	taskMap: Map<string, CompiledTask>,
): string[] {
	const result: string[] = [];

	// in-degree for each task
	const inDegree = new Map<string, number>();
	for (const task of tasks) {
		inDegree.set(task.id, 0);
	}
	for (const task of tasks) {
		for (const dep of task.dependencies) {
			inDegree.set(dep, inDegree.get(dep) ?? 0);
		}
	}

	// Tasks with no incoming edges
	const ready: string[] = [];
	for (const [id, degree] of inDegree.entries()) {
		if (degree === 0) ready.push(id);
	}

	// Sort ready queue deterministically: by explicit priority first,
	// then by dependency depth, then by task ID
	const taskById = new Map(tasks.map((t) => [t.id, t]));

	while (ready.length > 0) {
		// Sort ready queue deterministically
		ready.sort((a, b) => {
			const ta = taskById.get(a);
			const tb = taskById.get(b);
			if (!ta || !tb) return a.localeCompare(b);
			// Priority: lower number = higher priority
			const pa = ta.priority ?? 999;
			const pb = tb.priority ?? 999;
			if (pa !== pb) return pa - pb;
			// Dependency depth: tasks with more deps should come later
			const depthA = countDepth(a, taskMap);
			const depthB = countDepth(b, taskMap);
			if (depthA !== depthB) return depthA - depthB;
			// Finally, task ID string order for determinism
			return a.localeCompare(b);
		});

		const next = ready.shift();
		if (!next) break;
		result.push(next);

		// Reduce in-degree for dependents
		for (const dependent of dependents.get(next ?? "") ?? []) {
			const newDegree = (inDegree.get(dependent) ?? 1) - 1;
			inDegree.set(dependent, newDegree);
			if (newDegree === 0) {
				ready.push(dependent);
			}
		}
	}

	return result;
}

// ─── Dependency depth helper ───────────────────────────────────────────────

function countDepth(
	taskId: string,
	taskMap: Map<string, CompiledTask>,
): number {
	const task = taskMap.get(taskId);
	if (!task || task.dependencies.length === 0) return 0;
	let max = 0;
	for (const dep of task.dependencies) {
		const d = countDepth(dep, taskMap);
		if (d > max) max = d;
	}
	return max + 1;
}

// ─── Dependency map (for use by topologicalSort) ───────────────────────────

const dependents = new Map<string, string[]>();

export { dependents };
