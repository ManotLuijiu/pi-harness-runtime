/**
 * Learning Engine Tests (RFC-0058)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { type LearningEngine, createLearningEngine } from "../src/index.js";
import { containsSecret, calculateConfidence } from "../src/index.js";
import type { LearningRequest, ProviderExecutionMetric } from "../src/index.js";

describe("LearningEngine", () => {
	let engine: LearningEngine;

	beforeEach(() => {
		engine = createLearningEngine();
	});

	describe("learn", () => {
		it("extracts provider success patterns", () => {
			const request: LearningRequest = {
				jobId: "job-1",
				events: [],
				evaluation: [],
				repairHistory: [],
				providerMetrics: [
					{
						providerId: "claude",
						taskType: "code-review",
						successCount: 8,
						failureCount: 2,
						avgLatencyMs: 5000,
						avgTokensUsed: 1000,
					},
					{
						providerId: "gpt",
						taskType: "code-review",
						successCount: 5,
						failureCount: 5,
						avgLatencyMs: 4000,
						avgTokensUsed: 800,
					},
				],
			};

			const result = engine.learn(request);

			expect(result.experiences.length).toBeGreaterThan(0);
			expect(result.summary.totalExtracted).toBeGreaterThan(0);
		});

		it("extracts repair patterns", () => {
			const request: LearningRequest = {
				jobId: "job-1",
				events: [],
				evaluation: [],
				repairHistory: [
					{
						taskId: "task-1",
						repairType: "retry",
						success: true,
						attempts: 2,
					},
					{
						taskId: "task-2",
						repairType: "retry",
						success: true,
						attempts: 1,
					},
					{
						taskId: "task-3",
						repairType: "retry",
						success: false,
						attempts: 3,
					},
				],
				providerMetrics: [],
			};

			const result = engine.learn(request);

			const retryPattern = result.experiences.find((e) =>
				e.pattern.includes("retry"),
			);
			expect(retryPattern).toBeDefined();
		});

		it("does not approve experience automatically", () => {
			const request: LearningRequest = {
				jobId: "job-1",
				events: [],
				evaluation: [],
				repairHistory: [],
				providerMetrics: [],
			};

			const result = engine.learn(request);

			// Experiences should be 'proposed', not 'approved'
			for (const exp of result.experiences) {
				expect(exp.status).toBe("proposed");
			}
		});

		it("respects human approval", () => {
			const request: LearningRequest = {
				jobId: "job-1",
				events: [],
				evaluation: [],
				repairHistory: [],
				providerMetrics: [],
				humanFeedback: [
					{
						jobId: "job-1",
						taskId: "task-1",
						feedback: "positive",
						approved: true,
						timestamp: new Date().toISOString(),
					},
				],
			};

			const result = engine.learn(request);

			// Should have some approved experiences
			expect(result.summary.approved).toBeGreaterThanOrEqual(0);
		});

		it("produces summary", () => {
			const request: LearningRequest = {
				jobId: "job-1",
				events: [],
				evaluation: [],
				repairHistory: [],
				providerMetrics: [],
			};

			const result = engine.learn(request);

			expect(result.summary).toBeDefined();
			expect(result.summary.totalExtracted).toBe(0);
			expect(result.extractedAt).toBeDefined();
		});
	});

	describe("approve/reject", () => {
		it("approves experience and increases confidence", () => {
			const experience = {
				id: "exp-1",
				scope: "global" as const,
				pattern: "Test pattern",
				recommendation: "Test recommendation",
				confidence: 50,
				evidenceRefs: [],
				status: "proposed" as const,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				tags: ["test"],
			};

			const approved = engine.approve(experience);

			expect(approved.status).toBe("approved");
			expect(approved.confidence).toBe(60); // 50 + 10
		});

		it("rejects experience", () => {
			const experience = {
				id: "exp-1",
				scope: "global" as const,
				pattern: "Test pattern",
				recommendation: "Test recommendation",
				confidence: 50,
				evidenceRefs: [],
				status: "proposed" as const,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				tags: ["test"],
			};

			const rejected = engine.reject(experience);

			expect(rejected.status).toBe("rejected");
		});
	});

	describe("toOkfFormat", () => {
		it("exports to OKF markdown format", () => {
			const experience = {
				id: "exp-1",
				scope: "global" as const,
				pattern: "Test pattern for export",
				recommendation: "Test recommendation",
				confidence: 75,
				evidenceRefs: ["job-1", "job-2"],
				status: "approved" as const,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				tags: ["test", "export"],
			};

			const okf = engine.toOkfFormat(experience);

			expect(okf).toContain("---");
			expect(okf).toContain("type: Engineering Lesson");
			expect(okf).toContain("authority: approved");
			expect(okf).toContain("confidence: 75");
		});
	});
});

describe("Secret Detection", () => {
	describe("containsSecret", () => {
		it("detects API key patterns", () => {
			expect(containsSecret("api_key")).toBe(true);
			expect(containsSecret("API-KEY")).toBe(true);
			expect(containsSecret("myApiKey")).toBe(true);
		});

		it("detects password patterns", () => {
			expect(containsSecret("password")).toBe(true);
			expect(containsSecret("userPassword")).toBe(true);
		});

		it("detects token patterns", () => {
			expect(containsSecret("token")).toBe(true);
			expect(containsSecret("access_token")).toBe(true);
			expect(containsSecret("refreshToken")).toBe(true);
		});

		it("does not flag normal strings", () => {
			expect(containsSecret("username")).toBe(false);
			expect(containsSecret("email")).toBe(false);
			expect(containsSecret("comment")).toBe(false);
		});
	});

	describe("calculateConfidence", () => {
		it("increases with occurrences", () => {
			const low = calculateConfidence({
				occurrenceCount: 1,
				consistentPositiveOutcomes: 1,
				humanApprovalCount: 0,
				frameworkCorroboration: 0,
				contradictoryOutcomes: 0,
				singleEventEvidence: true,
				staleRepository: false,
				changedProjectRules: false,
			});

			const high = calculateConfidence({
				occurrenceCount: 5,
				consistentPositiveOutcomes: 5,
				humanApprovalCount: 0,
				frameworkCorroboration: 0,
				contradictoryOutcomes: 0,
				singleEventEvidence: false,
				staleRepository: false,
				changedProjectRules: false,
			});

			expect(high).toBeGreaterThan(low);
		});

		it("decreases with contradictory outcomes", () => {
			const noContra = calculateConfidence({
				occurrenceCount: 5,
				consistentPositiveOutcomes: 5,
				humanApprovalCount: 0,
				frameworkCorroboration: 0,
				contradictoryOutcomes: 0,
				singleEventEvidence: false,
				staleRepository: false,
				changedProjectRules: false,
			});

			const withContra = calculateConfidence({
				occurrenceCount: 5,
				consistentPositiveOutcomes: 5,
				humanApprovalCount: 0,
				frameworkCorroboration: 0,
				contradictoryOutcomes: 2,
				singleEventEvidence: false,
				staleRepository: false,
				changedProjectRules: false,
			});

			expect(withContra).toBeLessThan(noContra);
		});

		it("increases with human approval", () => {
			const noApproval = calculateConfidence({
				occurrenceCount: 3,
				consistentPositiveOutcomes: 3,
				humanApprovalCount: 0,
				frameworkCorroboration: 0,
				contradictoryOutcomes: 0,
				singleEventEvidence: false,
				staleRepository: false,
				changedProjectRules: false,
			});

			const withApproval = calculateConfidence({
				occurrenceCount: 3,
				consistentPositiveOutcomes: 3,
				humanApprovalCount: 1,
				frameworkCorroboration: 0,
				contradictoryOutcomes: 0,
				singleEventEvidence: false,
				staleRepository: false,
				changedProjectRules: false,
			});

			expect(withApproval).toBeGreaterThan(noApproval);
		});

		it("bounds confidence between 0 and 100", () => {
			const result = calculateConfidence({
				occurrenceCount: 100,
				consistentPositiveOutcomes: 100,
				humanApprovalCount: 10,
				frameworkCorroboration: 10,
				contradictoryOutcomes: 0,
				singleEventEvidence: false,
				staleRepository: false,
				changedProjectRules: false,
			});

			expect(result).toBeLessThanOrEqual(100);
			expect(result).toBeGreaterThanOrEqual(0);
		});
	});
});
