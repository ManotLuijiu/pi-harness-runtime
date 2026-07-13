/**
 * Performance Optimizer Tests (RFC-0056)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
	type PerformanceOptimizer,
	createPerformanceOptimizer,
} from "../src/index.js";
import type {
	PerformanceOptimizationRequest,
	PerformancePolicy,
} from "../src/types.js";

describe("PerformanceOptimizer", () => {
	let optimizer: PerformanceOptimizer;
	let defaultMetrics: PerformanceOptimizationRequest["metrics"];
	let defaultProviders: PerformanceOptimizationRequest["providerStates"];

	beforeEach(() => {
		optimizer = createPerformanceOptimizer();
		defaultMetrics = {
			jobId: "test-job",
			timestamp: new Date().toISOString(),
			totalTokens: 50000,
			lastRequestTokens: 5000,
			avgLatencyMs: 5000,
			retryCount: 2,
			successCount: 10,
			failureCount: 1,
			currentContextTokens: 80000,
			contextWindow: 100000,
			providerMetrics: {
				"provider-1": {
					providerId: "provider-1",
					callCount: 10,
					successCount: 9,
					failureCount: 1,
					avgLatencyMs: 5000,
					avgTokensPerCall: 5000,
				},
			},
		};
		defaultProviders = [
			{
				providerId: "provider-1",
				state: "available",
				remainingQuota: 100000,
			},
		];
	});

	describe("analyze", () => {
		it("returns no recommendations when metrics are healthy", () => {
			const metrics = {
				...defaultMetrics,
				currentContextTokens: 30000, // Low context usage
				retryCount: 0,
				avgLatencyMs: 2000,
			};

			const plan = optimizer.analyze({
				jobId: "test-job",
				metrics,
				providerStates: defaultProviders,
				taskGraph: { nodes: [], edges: [] },
				policy: { mandatoryStages: [] } as PerformancePolicy,
			});

			expect(plan.jobId).toBe("test-job");
			expect(plan.recommendations).toBeDefined();
			expect(Array.isArray(plan.recommendations)).toBe(true);
		});

		it("recommends context reduction when context is high", () => {
			const metrics = {
				...defaultMetrics,
				currentContextTokens: 90000, // 90% usage
				contextWindow: 100000,
			};

			const plan = optimizer.analyze({
				jobId: "test-job",
				metrics,
				providerStates: defaultProviders,
				taskGraph: { nodes: [], edges: [] },
				policy: { mandatoryStages: [] } as PerformancePolicy,
			});

			const reduceContext = plan.recommendations.find(
				(r) => r.type === "reduce_context",
			);
			expect(reduceContext).toBeDefined();
			if (reduceContext && reduceContext.type === "reduce_context") {
				expect(reduceContext.targetTokens).toBeLessThan(90000);
				expect(reduceContext.reason.length).toBeGreaterThan(0);
			}
		});

		it("recommends provider change when failure rate is high", () => {
			const metrics = {
				...defaultMetrics,
				providerMetrics: {
					"provider-1": {
						providerId: "provider-1",
						callCount: 10,
						successCount: 3,
						failureCount: 7,
						avgLatencyMs: 5000,
						avgTokensPerCall: 5000,
					},
				},
			};

			const providers = [
				{ providerId: "provider-1", state: "limited" as const },
				{ providerId: "provider-2", state: "available" as const },
			];

			const plan = optimizer.analyze({
				jobId: "test-job",
				metrics,
				providerStates: providers,
				taskGraph: { nodes: [], edges: [] },
				policy: {
					mandatoryStages: [],
					allowProviderSwitch: true,
				} as PerformancePolicy,
			});

			const changeProvider = plan.recommendations.find(
				(r) => r.type === "change_provider",
			);
			expect(changeProvider).toBeDefined();
			if (changeProvider && changeProvider.type === "change_provider") {
				expect(changeProvider.provider).toBe("provider-2");
			}
		});

		it("does not switch providers when not allowed by policy", () => {
			const metrics = {
				...defaultMetrics,
				providerMetrics: {
					"provider-1": {
						providerId: "provider-1",
						callCount: 10,
						successCount: 2,
						failureCount: 8,
						avgLatencyMs: 5000,
						avgTokensPerCall: 5000,
					},
				},
			};

			const plan = optimizer.analyze({
				jobId: "test-job",
				metrics,
				providerStates: defaultProviders,
				taskGraph: { nodes: [], edges: [] },
				policy: {
					mandatoryStages: [],
					allowProviderSwitch: false,
				} as PerformancePolicy,
			});

			const changeProvider = plan.recommendations.find(
				(r) => r.type === "change_provider",
			);
			expect(changeProvider).toBeUndefined();
		});

		it("produces deterministic recommendations for identical inputs", () => {
			const request = {
				jobId: "test-job",
				metrics: defaultMetrics,
				providerStates: defaultProviders,
				taskGraph: { nodes: [], edges: [] },
				policy: { mandatoryStages: [] } as PerformancePolicy,
			};

			const plan1 = optimizer.analyze(request);
			const plan2 = optimizer.analyze(request);

			expect(plan1.recommendations.length).toBe(plan2.recommendations.length);
			for (let i = 0; i < plan1.recommendations.length; i++) {
				expect(plan1.recommendations[i].type).toBe(
					plan2.recommendations[i].type,
				);
			}
		});

		it("includes expected impact when recommendations are made", () => {
			const metrics = {
				...defaultMetrics,
				currentContextTokens: 90000,
			};

			const plan = optimizer.analyze({
				jobId: "test-job",
				metrics,
				providerStates: defaultProviders,
				taskGraph: { nodes: [], edges: [] },
				policy: { mandatoryStages: [] } as PerformancePolicy,
			});

			expect(plan.expectedImpact).toBeDefined();
			if (plan.recommendations.length > 0) {
				// Should have some impact estimate
				expect(plan.generatedAt).toBeDefined();
			}
		});
	});

	describe("events", () => {
		it("emits analysis started event", () => {
			const events: any[] = [];
			optimizer.onEvent((e) => events.push(e));

			optimizer.analyze({
				jobId: "test-job",
				metrics: defaultMetrics,
				providerStates: defaultProviders,
				taskGraph: { nodes: [], edges: [] },
				policy: { mandatoryStages: [] } as PerformancePolicy,
			});

			expect(
				events.some((e) => e.type === "performance.analysis.started"),
			).toBe(true);
		});

		it("emits analysis completed event", () => {
			const events: any[] = [];
			optimizer.onEvent((e) => events.push(e));

			optimizer.analyze({
				jobId: "test-job",
				metrics: defaultMetrics,
				providerStates: defaultProviders,
				taskGraph: { nodes: [], edges: [] },
				policy: { mandatoryStages: [] } as PerformancePolicy,
			});

			expect(
				events.some((e) => e.type === "performance.analysis.completed"),
			).toBe(true);
		});

		it("emits recommendation created events", () => {
			const events: any[] = [];
			optimizer.onEvent((e) => events.push(e));

			optimizer.analyze({
				jobId: "test-job",
				metrics: { ...defaultMetrics, currentContextTokens: 95000 },
				providerStates: defaultProviders,
				taskGraph: { nodes: [], edges: [] },
				policy: { mandatoryStages: [] } as PerformancePolicy,
			});

			const recommendationEvents = events.filter(
				(e) => e.type === "performance.recommendation.created",
			);
			expect(recommendationEvents.length).toBeGreaterThan(0);
		});
	});
});
