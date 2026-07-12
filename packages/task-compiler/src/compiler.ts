/**
 * Task Compiler - Main Entry Point
 *
 * Compiles a compiled requirement + project profile into an executable task DAG.
 *
 * Algorithm:
 * 1. Decompose requirement into candidate tasks
 * 2. Assign file scope and ownership
 * 3. Assign verification outputs
 * 4. Apply command policy
 * 5. Build DAG with topological sort
 * 6. Validate: cycles, overlap, verification
 * 7. Assign provider hints
 */

import { applyCommandPolicy } from "./command-policy.js";
import { decomposeRequirement } from "./decompose.js";
import { assignFileScope } from "./file-scope.js";
import { buildGraph } from "./graph.js";
import type {
	TaskCompileInput,
	TaskCompilerConfig,
	TaskGraph,
} from "./types.js";
import {
	DEFAULT_TASK_COMPILER_CONFIG,
	PROVIDER_HINTS,
	TaskCompilerError,
	TaskCompilerErrorCode,
} from "./types.js";
import {
	assertEveryCriterionAssigned,
	assertEveryTaskHasVerification,
	assertNoCycles,
	assertNoEmptyObjectives,
	assertNoExclusiveFileOverlap,
} from "./validate.js";
import { assignVerification } from "./verification.js";

/**
 * Compile a requirement + project profile into an executable task graph.
 *
 * This is the main public API for the task compiler.
 */
export async function compileTasks(
	input: TaskCompileInput,
	config?: Partial<TaskCompilerConfig>,
): Promise<TaskGraph> {
	const fullConfig: TaskCompilerConfig = {
		...DEFAULT_TASK_COMPILER_CONFIG,
		...config,
	};

	// Clock used for reproducible timestamps (available for future use)
	fullConfig.clock;
	const jobId = input.jobId;

	// ─── Step 1: Decompose requirement into candidates ─────────────────────────

	const candidates = decomposeRequirement(input);

	if (candidates.length === 0) {
		throw new TaskCompilerError(
			TaskCompilerErrorCode.EMPTY_OBJECTIVE,
			`Requirement "${input.requirement.id}" produced no tasks after decomposition.`,
			{ requirementId: input.requirement.id },
		);
	}

	// ─── Step 2: Assign file scope and ownership ─────────────────────────────

	const tasksWithScope = assignFileScope(candidates, input.project);

	// ─── Step 3: Assign verification outputs ────────────────────────────────

	const tasksWithVerification = assignVerification(
		tasksWithScope,
		input.requirement,
	);

	// ─── Step 4: Apply command policy ───────────────────────────────────

	const tasksWithPolicy = applyCommandPolicy(
		tasksWithVerification,
		input.project,
	);

	// ─── Step 5: Assign jobId, provider hints, and finalize ───────────────

	const finalizedTasks = tasksWithPolicy.map((task) => ({
		...task,
		jobId,
		preferredProvider: PROVIDER_HINTS[task.type]?.[0],
	}));

	// ─── Step 6: Build graph ─────────────────────────────────────────────

	const graph = buildGraph(finalizedTasks);

	// ─── Step 7: Validate ────────────────────────────────────────────────

	assertNoEmptyObjectives(graph);
	assertNoCycles(graph);
	assertNoExclusiveFileOverlap(graph);
	assertEveryTaskHasVerification(graph);

	// Every acceptance criterion must be assigned to at least one task
	const acIds = input.requirement.acceptanceCriteria.map((c) => c.id);
	if (acIds.length > 0) {
		assertEveryCriterionAssigned(graph, acIds);
	}

	return graph;
}
