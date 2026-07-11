/**
 * Task Compiler - Verification Assignment
 *
 * Assigns TaskOutput (expectedOutputs) to each compiled task
 * so completion can be measured objectively.
 */

import type { CompiledRequirement, CompiledTask, TaskOutput } from "./types.js";

/**
 * Assign verification outputs to each task based on its type
 * and the requirement's acceptance criteria.
 */
export function assignVerification(
	tasks: CompiledTask[],
	requirement: CompiledRequirement,
): CompiledTask[] {
	return tasks.map((task) => {
		const outputs = buildOutputs(task, requirement);
		return { ...task, expectedOutputs: outputs };
	});
}

// ─── Output builders by task type ─────────────────────────────────────

function buildOutputs(
	task: CompiledTask,
	requirement: CompiledRequirement,
): TaskOutput[] {
	switch (task.type) {
		case "implementation": {
			return buildImplementationOutputs(task, requirement);
		}
		case "test": {
			return buildTestOutputs(task);
		}
		case "e2e_test": {
			return buildE2EOutputs(task);
		}
		case "review": {
			return buildReviewOutputs(task);
		}
		case "analysis": {
			return buildAnalysisOutputs(task);
		}
		case "design": {
			return buildDesignOutputs(task);
		}
		case "repair": {
			return buildRepairOutputs(task);
		}
		case "documentation": {
			return buildDocumentationOutputs(task);
		}
		default: {
			return [
				{
					kind: "verification",
					description: `Task "${task.title}" completed as expected.`,
					required: true,
				},
			];
		}
	}
}

// ─── Type-specific output builders ───────────────────────────────────

function buildImplementationOutputs(
	task: CompiledTask,
	requirement: CompiledRequirement,
): TaskOutput[] {
	const outputs: TaskOutput[] = [];

	// Required: at least one file was modified
	outputs.push({
		kind: "diff",
		description: `Implementation of "${task.title}" produces code changes`,
		required: true,
	});

	// Required: acceptance criteria are addressed
	if (task.acceptanceCriteria.length > 0) {
		outputs.push({
			kind: "verification",
			description: `All assigned acceptance criteria (${task.acceptanceCriteria.length}) are addressed`,
			required: true,
		});
	}

	// Optional: affected files mentioned in goal
	const goal = requirement.goals.find((g) =>
		task.objective.includes(g.description.slice(0, 30)),
	);
	if (goal) {
		outputs.push({
			kind: "verification",
			description: `Goal "${goal.description.slice(0, 60)}" is implemented`,
			required: true,
		});
	}

	// Risk verification for destructive operations
	const hasDestructive = requirement.riskTags.some(
		(r) => r.risk === "destructive_operation",
	);
	if (hasDestructive) {
		outputs.push({
			kind: "verification",
			description: "Destructive operations have rollback plan and approval",
			required: true,
		});
	}

	return outputs;
}

function buildTestOutputs(task: CompiledTask): TaskOutput[] {
	const outputs: TaskOutput[] = [
		{
			kind: "test_result",
			description: `Unit tests for "${task.title}" pass`,
			required: true,
		},
		{
			kind: "verification",
			description: "Test coverage is maintained above configured threshold",
			required: false,
		},
	];

	// All acceptance criteria must be tested
	if (task.acceptanceCriteria.length > 0) {
		outputs.push({
			kind: "verification",
			description: `All ${task.acceptanceCriteria.length} acceptance criteria have at least one test`,
			required: true,
		});
	}

	return outputs;
}

function buildE2EOutputs(task: CompiledTask): TaskOutput[] {
	return [
		{
			kind: "test_result",
			description: `E2E tests for "${task.title}" pass`,
			required: true,
		},
		{
			kind: "verification",
			description: "E2E test scenarios cover all critical user flows",
			required: true,
		},
	];
}

function buildReviewOutputs(task: CompiledTask): TaskOutput[] {
	const outputs: TaskOutput[] = [
		{
			kind: "report",
			description: `Review report for "${task.title}" is produced`,
			required: true,
		},
		{
			kind: "verification",
			description: "All review findings are addressed or explicitly accepted",
			required: true,
		},
	];

	if (task.acceptanceCriteria.length > 0) {
		outputs.push({
			kind: "verification",
			description: `${task.acceptanceCriteria.length} acceptance criteria are verified`,
			required: true,
		});
	}

	return outputs;
}

function buildAnalysisOutputs(task: CompiledTask): TaskOutput[] {
	return [
		{
			kind: "report",
			description: `Analysis report for "${task.title}" is produced`,
			required: true,
		},
		{
			kind: "schema",
			description: "Affected modules and dependencies are identified",
			required: true,
		},
	];
}

function buildDesignOutputs(task: CompiledTask): TaskOutput[] {
	return [
		{
			kind: "schema",
			description: `Design document/schema for "${task.title}" is produced`,
			required: true,
		},
		{
			kind: "file",
			description: "Architecture diagram or component model is included",
			required: false,
		},
	];
}

function buildRepairOutputs(task: CompiledTask): TaskOutput[] {
	return [
		{
			kind: "verification",
			description: `All review findings for "${task.title}" are resolved`,
			required: true,
		},
		{
			kind: "diff",
			description: "Repair changes are applied and verified",
			required: true,
		},
	];
}

function buildDocumentationOutputs(task: CompiledTask): TaskOutput[] {
	return [
		{
			kind: "file",
			path: "README.md",
			description: "README or user-facing documentation is updated",
			required: false,
		},
		{
			kind: "file",
			description: "API documentation reflects implementation",
			required: true,
		},
		{
			kind: "verification",
			description: `Documentation for "${task.title}" is complete`,
			required: true,
		},
	];
}
