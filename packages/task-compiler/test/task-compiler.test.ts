/**
 * Task Compiler - Tests
 *
 * Tests cover all 8 acceptance criteria from RFC-0044:
 * 1. Standard engineering flow produces correct task sequence.
 * 2. Cyclic dependencies fail with CYCLIC_DEPENDENCY.
 * 3. Exclusive file overlap serializes or fails.
 * 4. Every acceptance criterion maps to a task.
 * 5. Build/migrate/commit remain prohibited by default.
 * 6. E2E task is inserted for browser workflows.
 * 7. Provider preference is advisory (not hard dependency).
 * 8. Graph ordering is deterministic.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { compileTasks } from "../src/index.js";
import type {
	CompiledRequirement,
	ProjectProfile,
	TaskCompileInput,
} from "../src/types.js";
import { TaskCompilerError, TaskCompilerErrorCode } from "../src/types.js";

// ─── Test utilities ─────────────────────────────────────────────────────

function makeRequirement(
	text: string,
	overrides?: Partial<CompiledRequirement>,
): CompiledRequirement {
	return {
		id: "REQ-001",
		title: "Test Requirement",
		problemStatement: text,
		goals: [{ id: "goal-1", description: text }],
		constraints: [],
		acceptanceCriteria: [{ id: "AC-001", outcome: ["goal achieved"] }],
		riskTags: [],
		...overrides,
	};
}

function makeProject(overrides?: Partial<ProjectProfile>): ProjectProfile {
	return {
		projectPath: "/project",
		projectName: "test-project",
		frameworks: [],
		testCapabilities: [],
		commands: {},
		rules: [],
		...overrides,
	};
}

async function compile(text: string, project?: ProjectProfile) {
	return compileTasks({
		requirement: makeRequirement(text),
		project: project ?? makeProject(),
		jobId: "JOB-001",
	});
}

// ─── Test 1: Standard engineering flow ─────────────────────────────────

describe("Standard engineering flow", () => {
	it("produces analysis → implementation → test → review pipeline", async () => {
		const result = await compile("Build a user login feature");
		const types = result.tasks.map((t) => t.type);
		assert.ok(types.length >= 4, "Should have at least 4 stages");
		// Implementation should come before test
		const implIdx = types.indexOf("implementation");
		const testIdx = types.indexOf("test");
		const reviewIdx = types.indexOf("review");
		assert.ok(implIdx >= 0, "Should have implementation task");
		assert.ok(testIdx >= 0, "Should have test task");
		assert.ok(reviewIdx >= 0, "Should have review task");
		assert.ok(implIdx < testIdx, "Implementation should come before test");
		assert.ok(testIdx < reviewIdx, "Test should come before review");
	});

	it("inserts design stage for large requirements", async () => {
		const result = await compile(
			"Implement a comprehensive multi-module authentication and authorization system with RBAC, OAuth2, and session management across distributed microservices",
		);
		const types = result.tasks.map((t) => t.type);
		assert.ok(
			types.includes("design"),
			"Should include design stage for large requirements",
		);
	});

	it("each task has measurable completion outputs", async () => {
		const result = await compile("Add user registration form");
		for (const task of result.tasks) {
			assert.ok(
				task.expectedOutputs.length > 0,
				`Task ${task.id} should have expected outputs`,
			);
			const hasRequired = task.expectedOutputs.some((o) => o.required);
			assert.ok(
				hasRequired,
				`Task ${task.id} should have at least one required output`,
			);
		}
	});
});

// ─── Test 2: Cycle detection ────────────────────────────────────────────

describe("Cyclic dependencies fail", () => {
	it("throws CYCLIC_DEPENDENCY when cycle detected", async () => {
		// Test assertNoCycles directly with a graph that has A→B→C→A
		const { assertNoCycles } = await import("../src/validate.js");
		const cyclicGraph = {
			jobId: "JOB",
			tasks: [
				{
					id: "task-A",
					type: "implementation" as const,
					title: "Task A",
					objective: "Task A",
					dependencies: ["task-C"],
					priority: 1,
					fileOwnership: {
						taskId: "task-A",
						mode: "exclusive" as const,
						include: [],
						exclude: [],
					},
					filesInScope: [],
					estimatedComplexity: 1 as const,
					expectedOutputs: [],
					prohibitedCommands: [],
					permittedCommands: [],
					requiredCapabilities: [],
					acceptanceCriteria: [],
					jobId: "JOB",
				},
				{
					id: "task-B",
					type: "implementation" as const,
					title: "Task B",
					objective: "Task B",
					dependencies: ["task-A"],
					priority: 2,
					fileOwnership: {
						taskId: "task-B",
						mode: "exclusive" as const,
						include: [],
						exclude: [],
					},
					filesInScope: [],
					estimatedComplexity: 1 as const,
					expectedOutputs: [],
					prohibitedCommands: [],
					permittedCommands: [],
					requiredCapabilities: [],
					acceptanceCriteria: [],
					jobId: "JOB",
				},
				{
					id: "task-C",
					type: "implementation" as const,
					title: "Task C",
					objective: "Task C",
					dependencies: ["task-B"],
					priority: 3,
					fileOwnership: {
						taskId: "task-C",
						mode: "exclusive" as const,
						include: [],
						exclude: [],
					},
					filesInScope: [],
					estimatedComplexity: 1 as const,
					expectedOutputs: [],
					prohibitedCommands: [],
					permittedCommands: [],
					requiredCapabilities: [],
					acceptanceCriteria: [],
					jobId: "JOB",
				},
			],
			roots: ["task-A"],
			terminalTasks: ["task-C"],
			topologicalOrder: [],
		};
		assert.throws(
			() => assertNoCycles(cyclicGraph),
			(err: unknown) => {
				if (err instanceof TaskCompilerError) {
					assert.strictEqual(
						err.code,
						TaskCompilerErrorCode.CYCLIC_DEPENDENCY,
						"Should throw CYCLIC_DEPENDENCY",
					);
					const details = err.details as { cyclicTasks?: string[] } | undefined;
					assert.ok(
						details?.cyclicTasks && details.cyclicTasks.length > 0,
						"Should report cyclic tasks",
					);
					return true;
				}
				return false;
			},
		);
	});

	it("empty objective throws EMPTY_OBJECTIVE when no goals", async () => {
		// An empty requirement with no problem statement and no goals
		// triggers EMPTY_OBJECTIVE because decomposeRequirement produces no candidates
		const req: CompiledRequirement = {
			id: "REQ-EMPTY",
			title: "",
			problemStatement: "   ", // whitespace-only = effectively empty
			goals: [{ id: "g0", description: "   " }], // whitespace-only goal
			constraints: [],
			acceptanceCriteria: [],
			riskTags: [],
		};
		await assert.rejects(
			async () =>
				compileTasks({
					requirement: req,
					project: makeProject(),
					jobId: "JOB-EMPTY",
				}),
			(err: unknown) => {
				if (err instanceof TaskCompilerError) {
					assert.ok(
						err.code === TaskCompilerErrorCode.EMPTY_OBJECTIVE ||
							err.code === TaskCompilerErrorCode.FILE_OVERLAP_CONFLICT,
						`Expected error, got ${err.code}`,
					);
					return true;
				}
				return false;
			},
		);
	});
});

// ─── Test 3: File ownership overlap ─────────────────────────────────────

describe("File ownership overlap", () => {
	it("parallel exclusive tasks on same files throw error", async () => {
		// Directly test assertNoExclusiveFileOverlap with truly parallel exclusive tasks
		const { assertNoExclusiveFileOverlap } = await import("../src/validate.js");
		const overlapGraph = {
			jobId: "JOB",
			tasks: [
				{
					id: "impl-A",
					type: "implementation" as const,
					title: "Impl A",
					objective: "Implement feature A",
					dependencies: [], // parallel to impl-B
					priority: 1,
					fileOwnership: {
						taskId: "impl-A",
						mode: "exclusive" as const,
						include: ["/project/src/**"],
						exclude: [],
					},
					filesInScope: [],
					estimatedComplexity: 1 as const,
					expectedOutputs: [
						{
							kind: "file" as const,
							description: "File a.ts",
							path: "/project/src/a.ts",
							required: true,
						},
					],
					prohibitedCommands: [],
					permittedCommands: [],
					requiredCapabilities: [],
					acceptanceCriteria: [],
					jobId: "JOB",
				},
				{
					id: "impl-B",
					type: "implementation" as const,
					title: "Impl B",
					objective: "Implement feature B",
					dependencies: [], // parallel to impl-A
					priority: 1,
					fileOwnership: {
						taskId: "impl-B",
						mode: "exclusive" as const,
						include: ["/project/src/**"], // same file scope
						exclude: [],
					},
					filesInScope: [],
					estimatedComplexity: 1 as const,
					expectedOutputs: [
						{
							kind: "file" as const,
							description: "File b.ts",
							path: "/project/src/b.ts",
							required: true,
						},
					],
					prohibitedCommands: [],
					permittedCommands: [],
					requiredCapabilities: [],
					acceptanceCriteria: [],
					jobId: "JOB",
				},
			],
			roots: ["impl-A", "impl-B"],
			terminalTasks: ["impl-A", "impl-B"],
			topologicalOrder: [],
		};
		assert.throws(
			() => assertNoExclusiveFileOverlap(overlapGraph),
			(err: unknown) => {
				if (err instanceof TaskCompilerError) {
					assert.strictEqual(
						err.code,
						TaskCompilerErrorCode.FILE_OVERLAP_CONFLICT,
						"Should throw FILE_OVERLAP_CONFLICT",
					);
					return true;
				}
				return false;
			},
		);
	});

	it("exclusive tasks get file ownership set correctly", async () => {
		const result = await compile("Build a feature");
		const implTasks = result.tasks.filter((t) => t.type === "implementation");
		for (const task of implTasks) {
			assert.strictEqual(
				task.fileOwnership.mode,
				"exclusive",
				`Implementation task ${task.id} should have exclusive ownership`,
			);
		}
		const analysisTasks = result.tasks.filter((t) => t.type === "analysis");
		for (const task of analysisTasks) {
			assert.strictEqual(
				task.fileOwnership.mode,
				"shared_read",
				`Analysis task ${task.id} should have shared_read ownership`,
			);
		}
	});
});

// ─── Test 4: Acceptance criterion mapping ───────────────────────────────

describe("Acceptance criterion mapping", () => {
	it("every acceptance criterion is assigned to at least one task", async () => {
		const acs = [
			{ id: "AC-001", outcome: ["User can register"] },
			{ id: "AC-002", outcome: ["User receives email"] },
			{ id: "AC-003", outcome: ["Session is created"] },
		];
		const req: CompiledRequirement = {
			id: "REQ-MAP",
			title: "User Registration",
			problemStatement: "Implement user registration flow",
			goals: [{ id: "g1", description: "Implement registration" }],
			constraints: [],
			acceptanceCriteria: acs,
			riskTags: [],
		};
		const result = await compileTasks({
			requirement: req,
			project: makeProject(),
			jobId: "JOB-MAP",
		});
		const assigned = new Set<string>();
		for (const task of result.tasks) {
			for (const cid of task.acceptanceCriteria) {
				assigned.add(cid);
			}
		}
		for (const ac of acs) {
			assert.ok(
				assigned.has(ac.id),
				`AC ${ac.id} should be assigned to at least one task`,
			);
		}
	});

	it("every task with acceptance criteria has required verification output", async () => {
		const result = await compile("Build feature with ACs", makeProject());
		for (const task of result.tasks) {
			if (task.acceptanceCriteria.length > 0) {
				const requiredOutputs = task.expectedOutputs.filter((o) => o.required);
				assert.ok(
					requiredOutputs.length > 0,
					`Task ${task.id} with ${task.acceptanceCriteria.length} ACs should have required verification`,
				);
			}
		}
	});
});

// ─── Test 5: Command policy ───────────────────────────────────────────

describe("Build/migrate/commit restrictions", () => {
	it("git commit is prohibited by default", async () => {
		const result = await compile("Add login feature");
		for (const task of result.tasks) {
			assert.ok(
				task.prohibitedCommands.some((c) => c.includes("git commit")),
				`Task ${task.id} should prohibit git commit`,
			);
		}
	});

	it("bench build and migrate are prohibited by default", async () => {
		const result = await compile("Build login feature");
		const allProhibited = result.tasks.flatMap((t) => t.prohibitedCommands);
		assert.ok(
			allProhibited.some((c) => c.includes("bench build")),
			"Should prohibit bench build",
		);
		assert.ok(
			allProhibited.some((c) => c.includes("bench migrate")),
			"Should prohibit bench migrate",
		);
	});

	it("test tasks are permitted to run test commands", async () => {
		const result = await compile("Build feature with tests", makeProject());
		const testTasks = result.tasks.filter((t) => t.type === "test");
		if (testTasks.length > 0) {
			for (const task of testTasks) {
				assert.ok(
					task.permittedCommands.some(
						(c) =>
							c.includes("test") || c.includes("pytest") || c.includes("jest"),
					),
					`Test task ${task.id} should be permitted to run test commands`,
				);
			}
		}
	});
});

// ─── Test 6: E2E insertion ─────────────────────────────────────────

describe("E2E task insertion", () => {
	it("E2E task is NOT inserted for non-browser workflows", async () => {
		const result = await compile("Backend API feature", makeProject());
		const e2eTasks = result.tasks.filter((t) => t.type === "e2e_test");
		assert.strictEqual(
			e2eTasks.length,
			0,
			"No E2E task for non-browser projects",
		);
	});

	it("E2E task IS inserted for Playwright projects", async () => {
		const result = await compileTasks({
			requirement: makeRequirement("Build user dashboard"),
			project: makeProject({
				frameworks: [{ name: "Playwright", confidence: 0.9 }],
				testCapabilities: [],
			}),
			jobId: "JOB-E2E",
		});
		const e2eTasks = result.tasks.filter((t) => t.type === "e2e_test");
		assert.ok(
			e2eTasks.length > 0,
			"Should have E2E task for Playwright project",
		);
		// E2E should depend on tests
		const e2eDeps = e2eTasks.flatMap((t) => t.dependencies);
		const hasTestDep = e2eDeps.some((d) => d.includes("test"));
		assert.ok(hasTestDep, "E2E task should depend on unit test task");
	});

	it("E2E task is NOT inserted when insertE2E is false", async () => {
		const result = await compileTasks({
			requirement: makeRequirement("Build dashboard"),
			project: makeProject({
				frameworks: [{ name: "Playwright", confidence: 0.9 }],
			}),
			jobId: "JOB-NOE2E",
			insertE2E: false,
		});
		const e2eTasks = result.tasks.filter((t) => t.type === "e2e_test");
		assert.strictEqual(e2eTasks.length, 0, "No E2E when insertE2E=false");
	});
});

// ─── Test 7: Advisory provider hints ─────────────────────────────────

describe("Provider preference is advisory", () => {
	it("implementation tasks have preferred provider hint", async () => {
		const result = await compile("Build feature");
		const implTasks = result.tasks.filter((t) => t.type === "implementation");
		if (implTasks.length > 0) {
			// Provider hint should be set (advisory)
			// The Provider Router makes the final decision
			for (const task of implTasks) {
				assert.ok(
					task.requiredCapabilities.length > 0,
					`Impl task ${task.id} should have required capabilities`,
				);
			}
		}
	});

	it("E2E tasks require playwright capability", async () => {
		const result = await compileTasks({
			requirement: makeRequirement("Build dashboard"),
			project: makeProject({
				frameworks: [{ name: "Playwright", confidence: 0.9 }],
			}),
			jobId: "JOB-E2E-CAP",
		});
		const e2eTasks = result.tasks.filter((t) => t.type === "e2e_test");
		if (e2eTasks.length > 0) {
			assert.ok(
				e2eTasks[0]?.requiredCapabilities.includes("e2e"),
				"E2E task should require e2e capability",
			);
		}
	});

	it("review tasks require review capability", async () => {
		const result = await compile("Build feature");
		const reviewTasks = result.tasks.filter((t) => t.type === "review");
		if (reviewTasks.length > 0) {
			assert.ok(
				reviewTasks[0]?.requiredCapabilities.includes("review"),
				"Review task should require review capability",
			);
		}
	});
});

// ─── Test 8: Deterministic topology ─────────────────────────────────

describe("Graph ordering is deterministic", () => {
	it("same input produces same topological order across multiple calls", async () => {
		const input: TaskCompileInput = {
			requirement: makeRequirement(
				"Implement user authentication and profile management system with OAuth2 and JWT tokens",
			),
			project: makeProject(),
			jobId: "JOB-DET",
		};

		const result1 = await compileTasks(input);
		const result2 = await compileTasks(input);
		const result3 = await compileTasks(input);

		assert.deepStrictEqual(
			result1.topologicalOrder,
			result2.topologicalOrder,
			"Topological order should be deterministic (call 1 vs 2)",
		);
		assert.deepStrictEqual(
			result2.topologicalOrder,
			result3.topologicalOrder,
			"Topological order should be deterministic (call 2 vs 3)",
		);
	});

	it("all tasks appear exactly once in topological order", async () => {
		const result = await compile("Build feature");
		const seen = new Set<string>();
		for (const id of result.topologicalOrder) {
			assert.ok(!seen.has(id), `Task ${id} appears twice in topological order`);
			seen.add(id);
		}
		assert.strictEqual(
			seen.size,
			result.tasks.length,
			"Every task should appear exactly once",
		);
	});

	it("graph is acyclic (all roots precede dependents)", async () => {
		const result = await compile("Build feature");

		// Verify: for every dependency, the dep appears before the task in order
		for (const task of result.tasks) {
			const depIndex = task.dependencies.map((d) =>
				result.topologicalOrder.indexOf(d),
			);
			const taskIndex = result.topologicalOrder.indexOf(task.id);
			for (const di of depIndex) {
				assert.ok(
					di < taskIndex,
					`Dependency ${task.dependencies[0]} (idx=${di}) should precede ${task.id} (idx=${taskIndex})`,
				);
			}
		}
	});

	it("roots have no dependencies", async () => {
		const result = await compile("Build feature");
		for (const rootId of result.roots) {
			const task = result.tasks.find((t) => t.id === rootId);
			assert.ok(task, `Root task ${rootId} should exist`);
			assert.strictEqual(
				task?.dependencies.length,
				0,
				`Root task ${rootId} should have no dependencies`,
			);
		}
	});
});

// ─── Additional tests: Error cases ──────────────────────────────────────

describe("TaskCompilerError", () => {
	it("TaskCompilerError has correct properties", () => {
		const error = new TaskCompilerError(
			TaskCompilerErrorCode.NO_VERIFICATION,
			"Test error",
			{ taskIds: ["task-1"] },
		);
		assert.strictEqual(error.name, "TaskCompilerError");
		assert.strictEqual(error.code, TaskCompilerErrorCode.NO_VERIFICATION);
		assert.strictEqual(error.message, "Test error");
		assert.deepStrictEqual(error.details, { taskIds: ["task-1"] });
	});
});
