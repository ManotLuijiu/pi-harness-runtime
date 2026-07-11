/**
 * Task Compiler - Validation
 *
 * Validates the task graph: cycle detection, file overlap, verification, etc.
 */

import type { TaskGraph } from "./types.js";
import { TaskCompilerError, TaskCompilerErrorCode } from "./types.js";

/**
 * Assert the graph has no cycles.
 * Uses Kahn's algorithm to verify all tasks are reachable in topological order.
 */
export function assertNoCycles(graph: TaskGraph): void {
	// Compute in-degrees: how many dependencies each task has
	const inDegree = new Map<string, number>();
	for (const task of graph.tasks) {
		inDegree.set(task.id, task.dependencies.length);
	}

	// Kahn's algorithm
	const queue: string[] = [];
	for (const [id, degree] of inDegree.entries()) {
		if (degree === 0) queue.push(id);
	}
	const visited: string[] = [];

	while (queue.length > 0) {
		const id = queue.shift();
		if (!id) break;
		visited.push(id);

		// Reduce in-degree of tasks that depend on `id`
		for (const task of graph.tasks) {
			if (task.dependencies.includes(id)) {
				const newDegree = (inDegree.get(task.id) ?? 1) - 1;
				inDegree.set(task.id, newDegree);
				if (newDegree === 0) {
					queue.push(task.id);
				}
			}
		}
	}

	if (visited.length !== graph.tasks.length) {
		const unvisited = graph.tasks
			.filter((t) => !visited.includes(t.id))
			.map((t) => t.id);
		throw new TaskCompilerError(
			TaskCompilerErrorCode.CYCLIC_DEPENDENCY,
			`Cyclic dependency detected. Tasks in cycle: ${unvisited.join(", ")}`,
			{ cyclicTasks: unvisited },
		);
	}
}

/**
 * Assert no exclusive file overlap between parallel tasks.
 * Two exclusive tasks cannot modify the same files unless one depends on the other.
 */
export function assertNoExclusiveFileOverlap(graph: TaskGraph): void {
	const exclusiveTasks = graph.tasks.filter(
		(t) => t.fileOwnership.mode === "exclusive",
	);

	const overlaps: Array<{ taskA: string; taskB: string; files: string[] }> = [];

	for (let i = 0; i < exclusiveTasks.length; i++) {
		for (let j = i + 1; j < exclusiveTasks.length; j++) {
			const a = exclusiveTasks[i];
			const b = exclusiveTasks[j];

			// Sequential: skip if one depends on the other
			if (a.dependencies.includes(b.id) || b.dependencies.includes(a.id)) {
				continue;
			}

			// Both wait for same parent: not truly parallel
			const aRoots = getAllDependencies(a.id, graph);
			const bRoots = getAllDependencies(b.id, graph);
			if (Array.from(aRoots).some((d) => bRoots.has(d))) {
				continue;
			}

			const conflictFiles = findFileOverlap(a.fileOwnership, b.fileOwnership);
			if (conflictFiles.length > 0) {
				overlaps.push({
					taskA: a.id,
					taskB: b.id,
					files: conflictFiles,
				});
			}
		}
	}

	if (overlaps.length > 0) {
		const details = overlaps.map(
			(o) => `${o.taskA} ↔ ${o.taskB}: ${o.files.join(", ")}`,
		);
		throw new TaskCompilerError(
			TaskCompilerErrorCode.FILE_OVERLAP_CONFLICT,
			`Exclusive file overlap detected between parallel tasks: ${details.join("; ")}`,
			{ overlaps },
		);
	}
}

/**
 * Assert every task has at least one required verification output.
 */
export function assertEveryTaskHasVerification(graph: TaskGraph): void {
	const missing: string[] = [];
	for (const task of graph.tasks) {
		const requiredOutputs = task.expectedOutputs.filter((o) => o.required);
		if (requiredOutputs.length === 0) {
			missing.push(task.id);
		}
	}
	if (missing.length > 0) {
		throw new TaskCompilerError(
			TaskCompilerErrorCode.NO_VERIFICATION,
			`Tasks without required verification outputs: ${missing.join(", ")}`,
			{ taskIds: missing },
		);
	}
}

/**
 * Assert no task has an empty objective.
 */
export function assertNoEmptyObjectives(graph: TaskGraph): void {
	const empty: string[] = [];
	for (const task of graph.tasks) {
		if (!task.objective.trim()) {
			empty.push(task.id);
		}
	}
	if (empty.length > 0) {
		throw new TaskCompilerError(
			TaskCompilerErrorCode.EMPTY_OBJECTIVE,
			`Tasks with empty objectives: ${empty.join(", ")}`,
			{ taskIds: empty },
		);
	}
}

/**
 * Assert every acceptance criterion is assigned to at least one task.
 */
export function assertEveryCriterionAssigned(
	graph: TaskGraph,
	criterionIds: string[],
): void {
	const assigned = new Set<string>();
	for (const task of graph.tasks) {
		for (const cid of task.acceptanceCriteria) {
			assigned.add(cid);
		}
	}
	const unassigned = criterionIds.filter((c) => !assigned.has(c));
	if (unassigned.length > 0) {
		throw new TaskCompilerError(
			TaskCompilerErrorCode.UNSATISFIED_CRITERION,
			`Acceptance criteria not assigned to any task: ${unassigned.join(", ")}`,
			{ unassignedCriteria: unassigned },
		);
	}
}

// ─── File overlap detection ──────────────────────────────────────────

function findFileOverlap(
	a: import("./types.js").FileOwnership,
	b: import("./types.js").FileOwnership,
): string[] {
	const conflicts: string[] = [];

	for (const patternA of a.include) {
		for (const patternB of b.include) {
			if (patternA === patternB) {
				conflicts.push(patternA);
			} else if (patternSubsumes(patternA, patternB)) {
				conflicts.push(patternB);
			} else if (patternSubsumes(patternB, patternA)) {
				conflicts.push(patternA);
			}
		}
	}

	return [...new Set(conflicts)];
}

function patternSubsumes(parent: string, child: string): boolean {
	const p = parent.replace(/\/\*\*$/, "");
	return child.startsWith(`${p}/`) || child.startsWith(p);
}

// ─── Dependency helpers ────────────────────────────────────────────────

function getAllDependencies(taskId: string, graph: TaskGraph): Set<string> {
	const taskMap = new Map(graph.tasks.map((t) => [t.id, t]));
	const visited = new Set<string>();

	function walk(id: string) {
		if (visited.has(id)) return;
		const task = taskMap.get(id);
		if (task) {
			visited.add(id);
			for (const dep of task.dependencies) {
				walk(dep);
			}
		}
	}

	walk(taskId);
	visited.delete(taskId);
	return visited;
}
