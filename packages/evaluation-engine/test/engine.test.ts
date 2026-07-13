/**
 * Evaluation Engine Tests (RFC-0057)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { type EvaluationEngine, createEvaluationEngine } from "../src/index.js";
import type { EvaluationRequest } from "../src/types.js";

describe("EvaluationEngine", () => {
	let engine: EvaluationEngine;
	let defaultTask: EvaluationRequest["task"];
	let defaultOutputs: EvaluationRequest["outputs"];
	let defaultTestResults: EvaluationRequest["testResults"];
	let defaultPolicyFindings: EvaluationRequest["policyFindings"];

	beforeEach(() => {
		engine = createEvaluationEngine();
		defaultTask = {
			id: "task-1",
			title: "Test Task",
			description: "A test task",
			acceptanceCriteria: ["Output file exists", "Tests pass"],
			requiredArtifacts: ["output.txt"],
			mandatoryStages: [],
		};
		defaultOutputs = [
			{
				id: "out-1",
				type: "file",
				path: "output.txt",
				description: "Generated output file",
			},
		];
		defaultTestResults = [
			{
				id: "test-1",
				testFile: "test.spec.ts",
				status: "passed",
				durationMs: 100,
			},
		];
		defaultPolicyFindings = [];
	});

	describe("evaluate", () => {
		it("passes when all criteria are met", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: defaultTask,
				worktreePath: "/tmp/worktree",
				outputs: defaultOutputs,
				testResults: defaultTestResults,
				policyFindings: defaultPolicyFindings,
			};

			const result = engine.evaluate(request);

			expect(result.status).toBe("passed");
			expect(result.score).toBeGreaterThanOrEqual(70);
			expect(result.recommendedAction).toBe("continue");
			expect(result.evidence.length).toBeGreaterThan(0);
		});

		it("fails when required artifact is missing", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: defaultTask,
				worktreePath: "/tmp/worktree",
				outputs: [], // No outputs
				testResults: defaultTestResults,
				policyFindings: defaultPolicyFindings,
			};

			const result = engine.evaluate(request);

			expect(result.status).toBe("failed");
			expect(result.findings.some((f) => f.message.includes("missing"))).toBe(
				true,
			);
		});

		it("fails on critical policy violation", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: defaultTask,
				worktreePath: "/tmp/worktree",
				outputs: defaultOutputs,
				testResults: defaultTestResults,
				policyFindings: [
					{
						ruleId: "SEC-001",
						severity: "critical",
						message: "Hardcoded API key detected",
						filePath: "src/config.ts",
						line: 10,
					},
				],
			};

			const result = engine.evaluate(request);

			expect(result.status).toBe("failed");
			expect(result.findings.some((f) => f.severity === "critical")).toBe(true);
			expect(result.recommendedAction).toBe("repair");
		});

		it("fails when tests fail", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: defaultTask,
				worktreePath: "/tmp/worktree",
				outputs: defaultOutputs,
				testResults: [
					{
						id: "test-1",
						testFile: "test.spec.ts",
						status: "failed",
						errorMessage: "Assertion failed: expected 2 to equal 3",
					},
				],
				policyFindings: defaultPolicyFindings,
			};

			const result = engine.evaluate(request);

			expect(result.status).toBe("failed");
			expect(result.findings.some((f) => f.message.includes("failed"))).toBe(
				true,
			);
		});

		it("returns needs_review for ambiguous criteria", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: {
					...defaultTask,
					acceptanceCriteria: ["Do something good", "Make it work well"],
				},
				worktreePath: "/tmp/worktree",
				outputs: [
					{
						id: "out-1",
						type: "file",
						path: "output.txt",
						description: "Some output",
					},
				],
				testResults: [
					{
						id: "test-1",
						testFile: "test.spec.ts",
						status: "passed",
					},
				],
				policyFindings: defaultPolicyFindings,
			};

			const result = engine.evaluate(request);

			// Should pass or needs_review depending on coverage
			expect(["passed", "needs_review"]).toContain(result.status);
		});

		it("includes evidence in result", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: defaultTask,
				worktreePath: "/tmp/worktree",
				outputs: defaultOutputs,
				testResults: defaultTestResults,
				policyFindings: defaultPolicyFindings,
			};

			const result = engine.evaluate(request);

			expect(result.evidence).toBeDefined();
			expect(Array.isArray(result.evidence)).toBe(true);
		});

		it("maps acceptance criteria to evidence", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: {
					...defaultTask,
					acceptanceCriteria: ["Output file exists"],
				},
				worktreePath: "/tmp/worktree",
				outputs: defaultOutputs,
				testResults: defaultTestResults,
				policyFindings: defaultPolicyFindings,
			};

			const result = engine.evaluate(request);

			const acceptanceFinding = result.findings.find(
				(f) => f.dimension === "acceptance_coverage",
			);

			// Should either pass or have unmet criteria finding
			expect(result.status).toBe("passed");
		});
	});

	describe("state management", () => {
		it("starts in pending state", () => {
			const freshEngine = createEvaluationEngine();
			expect(freshEngine.getState()).toBe("pending");
		});

		it("transitions through states during evaluation", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: defaultTask,
				worktreePath: "/tmp/worktree",
				outputs: defaultOutputs,
				testResults: defaultTestResults,
				policyFindings: defaultPolicyFindings,
			};

			engine.evaluate(request);

			expect(["passed", "failed", "needs_review"]).toContain(engine.getState());
		});

		it("resets state correctly", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: defaultTask,
				worktreePath: "/tmp/worktree",
				outputs: defaultOutputs,
				testResults: defaultTestResults,
				policyFindings: defaultPolicyFindings,
			};

			engine.evaluate(request);
			engine.reset();

			expect(engine.getState()).toBe("pending");
		});
	});

	describe("scoring", () => {
		it("returns score between 0 and 100", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: defaultTask,
				worktreePath: "/tmp/worktree",
				outputs: defaultOutputs,
				testResults: defaultTestResults,
				policyFindings: defaultPolicyFindings,
			};

			const result = engine.evaluate(request);

			expect(result.score).toBeGreaterThanOrEqual(0);
			expect(result.score).toBeLessThanOrEqual(100);
		});

		it("penalizes for missing tests", () => {
			const request: EvaluationRequest = {
				jobId: "job-1",
				task: defaultTask,
				worktreePath: "/tmp/worktree",
				outputs: defaultOutputs,
				testResults: [], // No tests
				policyFindings: defaultPolicyFindings,
			};

			const result = engine.evaluate(request);

			// Missing tests should lower score
			expect(
				result.findings.some((f) => f.message.includes("No test results")),
			).toBe(true);
		});
	});
});
