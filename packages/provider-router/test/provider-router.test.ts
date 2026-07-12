/**
 * Provider Router Tests (RFC-0054)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	createProviderRouter,
	type EnhancedProviderRouter,
	DEFAULT_ROUTING_POLICY,
	createRoutingPolicy,
	applyStrategy,
	calculateWeightedScore,
	createDecision,
	LATENCY_RANK,
} from "../src/index.js";
import type {
	RoutingPolicy,
	ProviderCandidate,
	RoutingStrategy,
} from "../src/index.js";

describe("EnhancedProviderRouter", () => {
	let router: EnhancedProviderRouter;

	beforeEach(() => {
		router = createProviderRouter();
	});

	describe("initialization", () => {
		it("should initialize with default policy", () => {
			const policy = router.getRoutingPolicy();
			expect(policy.defaultStrategy).toBe("balanced");
		});

		it("should accept custom policy", () => {
			const customPolicy = createRoutingPolicy({ defaultStrategy: "cheapest" });
			const customRouter = createProviderRouter(customPolicy);
			expect(customRouter.getRoutingPolicy().defaultStrategy).toBe("cheapest");
		});
	});

	describe("selectProvider", () => {
		it("should select a provider", async () => {
			const task = {
				id: "task-1",
				title: "Code task",
				description: "",
				type: "code_generation",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {},
			};

			const decision = await router.selectProvider(task, context);

			expect(decision.providerId).toBeDefined();
			expect(decision.modelId).toBeDefined();
			expect(decision.reason).toBeDefined();
		});

		it("should prefer cheapest when specified", async () => {
			const task = {
				id: "task-1",
				title: "Code task",
				description: "",
				type: "code_generation",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {},
			};

			const decision = await router.selectProvider(task, context, {
				preferCheapest: true,
			});

			expect(decision.reason).toContain("cheapest");
		});

		it("should prefer fastest when specified", async () => {
			const task = {
				id: "task-1",
				title: "Code task",
				description: "",
				type: "code_generation",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {},
			};

			const decision = await router.selectProvider(task, context, {
				preferFastest: true,
			});

			expect(decision.reason).toContain("fastest");
		});

		it("should prefer highest quality when specified", async () => {
			const task = {
				id: "task-1",
				title: "Code task",
				description: "",
				type: "code_generation",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {},
			};

			const decision = await router.selectProvider(task, context, {
				preferHighestQuality: true,
			});

			expect(decision.reason).toContain("quality");
		});

		it("should filter by max cost", async () => {
			const task = {
				id: "task-1",
				title: "Code task",
				description: "",
				type: "code_generation",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {},
			};

			const decision = await router.selectProvider(task, context, {
				maxCostPerTask: 0.00001, // Very low cost
			});

			// Should still return a decision (fallback)
			expect(decision.providerId).toBeDefined();
		});

		it("should respect task type overrides", async () => {
			const task = {
				id: "task-1",
				title: "Plan",
				description: "",
				type: "planning",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {},
			};

			const decision = await router.selectProvider(task, context);

			// Planning should use best_quality strategy
			expect(decision.reason).toContain("best_quality");
		});

		it("should filter out exhausted providers", async () => {
			const task = {
				id: "task-1",
				title: "Code task",
				description: "",
				type: "code_generation",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {
					minimax: { exhausted: true, remainingPct: 0 },
				},
			};

			const decision = await router.selectProvider(task, context);

			// Should not select minimax if exhausted
			expect(decision.providerId).not.toBe("minimax");
		});

		it("should avoid specified providers", async () => {
			const task = {
				id: "task-1",
				title: "Code task",
				description: "",
				type: "code_generation",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {},
			};

			const decision = await router.selectProvider(task, context, {
				avoidProviders: ["minimax"],
			});

			expect(decision.providerId).not.toBe("minimax");
		});

		it("should emit selection event", async () => {
			const events: any[] = [];
			router.onEvent((e) => events.push(e));

			const task = {
				id: "task-1",
				title: "Code task",
				description: "",
				type: "code_generation",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {},
			};

			await router.selectProvider(task, context);

			expect(events).toContainEqual(
				expect.objectContaining({
					type: "router.provider_selected",
					taskId: "task-1",
				}),
			);
		});
	});

	describe("selectProviders", () => {
		it("should select multiple providers", async () => {
			const task = {
				id: "task-1",
				title: "Code task",
				description: "",
				type: "code_generation",
			};
			const context = {
				task,
				providerStates: {},
				quotaStates: {},
			};

			const decisions = await router.selectProviders(task, context, 3);

			expect(decisions).toHaveLength(3);
			expect(decisions[0].providerId).not.toBe(decisions[1].providerId);
		});
	});

	describe("setRoutingPolicy", () => {
		it("should update policy", () => {
			const newPolicy = createRoutingPolicy({ defaultStrategy: "fastest" });
			router.setRoutingPolicy(newPolicy);

			expect(router.getRoutingPolicy().defaultStrategy).toBe("fastest");
		});

		it("should emit policy update event", () => {
			const events: any[] = [];
			router.onEvent((e) => events.push(e));

			const newPolicy = createRoutingPolicy({ costWeight: 50 });
			router.setRoutingPolicy(newPolicy);

			expect(events).toContainEqual(
				expect.objectContaining({
					type: "router.policy_updated",
				}),
			);
		});
	});
});

describe("Strategies", () => {
	const defaultPolicy = DEFAULT_ROUTING_POLICY;

	const candidates: ProviderCandidate[] = [
		{
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
			capabilities: [],
			estimatedCost: 0.003,
			estimatedLatency: "fast",
			qualityScore: 90,
			remainingQuotaPct: 0.5,
		},
		{
			providerId: "openai",
			modelId: "gpt-4o-mini",
			capabilities: [],
			estimatedCost: 0.0006,
			estimatedLatency: "fast",
			qualityScore: 82,
			remainingQuotaPct: 0.8,
		},
		{
			providerId: "minimax",
			modelId: "MiniMax-Text-01",
			capabilities: [],
			estimatedCost: 0.0001,
			estimatedLatency: "fast",
			qualityScore: 75,
			remainingQuotaPct: 1,
		},
	];

	describe("applyStrategy", () => {
		it("should select cheapest with cheapest strategy", () => {
			const selected = applyStrategy(candidates, "cheapest", defaultPolicy);
			expect(selected.providerId).toBe("minimax");
		});

		it("should select fastest with fastest strategy", () => {
			const selected = applyStrategy(candidates, "fastest", defaultPolicy);
			// All have same latency, so should pick highest quality among fast
			expect(selected.estimatedLatency).toBe("fast");
		});

		it("should select best quality with best_quality strategy", () => {
			const selected = applyStrategy(candidates, "best_quality", defaultPolicy);
			expect(selected.providerId).toBe("anthropic");
		});

		it("should apply balanced scoring", () => {
			const selected = applyStrategy(candidates, "balanced", defaultPolicy);
			expect(selected.providerId).toBeDefined();
		});

		it("should apply quota awareness", () => {
			const selected = applyStrategy(candidates, "quota_aware", defaultPolicy);
			// Should prefer minimax (100% quota) even though it's cheapest
			expect(selected.providerId).toBe("minimax");
		});
	});

	describe("calculateWeightedScore", () => {
		it("should calculate weighted score", () => {
			const score = calculateWeightedScore(candidates[0], defaultPolicy);
			expect(score).toBeGreaterThan(0);
			expect(score).toBeLessThanOrEqual(100);
		});

		it("should weight cost appropriately", () => {
			// Use extreme cost weight to make cost the dominant factor
			const policy = createRoutingPolicy({
				costWeight: 100,
				qualityWeight: 0,
				latencyWeight: 0,
				quotaWeight: 0,
			});
			const scoreAnthropic = calculateWeightedScore(candidates[0], policy);
			const scoreMiniMax = calculateWeightedScore(candidates[2], policy);
			expect(scoreMiniMax).toBeGreaterThan(scoreAnthropic);
		});

		it("should weight quality appropriately", () => {
			const policy = createRoutingPolicy({ qualityWeight: 100 });
			const scoreAnthropic = calculateWeightedScore(candidates[0], policy);
			const scoreMiniMax = calculateWeightedScore(candidates[2], policy);
			expect(scoreAnthropic).toBeGreaterThan(scoreMiniMax);
		});
	});

	describe("createDecision", () => {
		it("should create decision from candidate", () => {
			const decision = createDecision(candidates[0], "test reason");
			expect(decision.providerId).toBe("anthropic");
			expect(decision.modelId).toBe("claude-sonnet-4");
			expect(decision.reason).toBe("test reason");
			expect(decision.estimatedCost).toBe(0.003);
			expect(decision.confidence).toBe(0.9);
		});
	});
});

describe("LATENCY_RANK", () => {
	it("should have correct ordering", () => {
		expect(LATENCY_RANK["fast"]).toBeLessThan(LATENCY_RANK["medium"]);
		expect(LATENCY_RANK["medium"]).toBeLessThan(LATENCY_RANK["slow"]);
	});
});

describe("createRoutingPolicy", () => {
	it("should merge with defaults", () => {
		const custom = createRoutingPolicy({
			defaultStrategy: "cheapest",
			costWeight: 80,
		});

		expect(custom.defaultStrategy).toBe("cheapest");
		expect(custom.costWeight).toBe(80);
		expect(custom.qualityWeight).toBe(DEFAULT_ROUTING_POLICY.qualityWeight);
	});

	it("should merge task type overrides", () => {
		const custom = createRoutingPolicy({
			taskTypeOverrides: { planning: "best_quality" },
		});

		expect(custom.taskTypeOverrides["planning"]).toBe("best_quality");
		expect(custom.taskTypeOverrides["code_generation"]).toBe("balanced");
	});
});
