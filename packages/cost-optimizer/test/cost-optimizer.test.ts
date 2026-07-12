/**
 * Cost Optimizer Tests (RFC-0055)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	createCostOptimizer,
	type InMemoryCostOptimizer,
	DEFAULT_CONFIG,
	createOptimizerConfig,
	generateCostId,
	createCostEntry,
	calculateSummary,
	calculateBudgetStatus,
	exceedsBudget,
	calculateModelCost,
	calculateQualityImpact,
	findCheaperAlternatives,
	optimizeModelSelection,
	forecastCosts,
	quickForecast,
} from "../src/index.js";
import type {
	CostEntry,
	CostPeriod,
	CostBudget,
	TaskRequirements,
} from "../src/index.js";

describe("CostOptimizer", () => {
	let optimizer: InMemoryCostOptimizer;

	beforeEach(() => {
		optimizer = createCostOptimizer();
	});

	describe("trackCost", () => {
		it("should track a cost entry", () => {
			const entry = optimizer.trackCost({
				jobId: "job-1",
				taskId: "task-1",
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				inputTokens: 1000,
				outputTokens: 500,
				cost: 0.005,
				currency: "USD",
			});

			expect(entry.id).toBeDefined();
			expect(entry.timestamp).toBeDefined();
			expect(entry.cost).toBe(0.005);
		});

		it("should accumulate costs", () => {
			optimizer.trackCost({
				jobId: "job-1",
				providerId: "openai",
				modelId: "gpt-4o",
				inputTokens: 1000,
				outputTokens: 500,
				cost: 0.003,
				currency: "USD",
			});

			optimizer.trackCost({
				jobId: "job-1",
				providerId: "minimax",
				modelId: "MiniMax-Text-01",
				inputTokens: 2000,
				outputTokens: 1000,
				cost: 0.001,
				currency: "USD",
			});

			const summary = optimizer.getSummary({ start: "", end: "", type: "day" });
			expect(summary.total).toBe(0.004);
		});

		it("should emit tracked event", () => {
			const events: any[] = [];
			optimizer.onEvent((e) => events.push(e));

			optimizer.trackCost({
				jobId: "job-1",
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				inputTokens: 1000,
				outputTokens: 500,
				cost: 0.005,
				currency: "USD",
			});

			expect(events).toContainEqual(
				expect.objectContaining({
					type: "cost.tracked",
				}),
			);
		});

		it("should emit budget warning when threshold exceeded", () => {
			const events: any[] = [];
			optimizer.onEvent((e) => events.push(e));

			// Track enough to exceed 80% of $10 daily budget
			for (let i = 0; i < 9; i++) {
				optimizer.trackCost({
					jobId: "job-1",
					providerId: "anthropic",
					modelId: "claude-sonnet-4",
					inputTokens: 1000,
					outputTokens: 500,
					cost: 0.95,
					currency: "USD",
				});
			}

			const warnings = events.filter((e) => e.type === "cost.budget_warning");
			expect(warnings.length).toBeGreaterThan(0);
		});
	});

	describe("getSummary", () => {
		it("should calculate summary by provider", () => {
			optimizer.trackCost({
				jobId: "job-1",
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				inputTokens: 1000,
				outputTokens: 500,
				cost: 0.01,
				currency: "USD",
			});

			optimizer.trackCost({
				jobId: "job-1",
				providerId: "openai",
				modelId: "gpt-4o",
				inputTokens: 1000,
				outputTokens: 500,
				cost: 0.02,
				currency: "USD",
			});

			const summary = optimizer.getSummary({ start: "", end: "", type: "day" });
			expect(summary.total).toBe(0.03);
			expect(summary.byProvider["anthropic"]).toBe(0.01);
			expect(summary.byProvider["openai"]).toBe(0.02);
		});

		it("should calculate summary by job", () => {
			optimizer.trackCost({
				jobId: "job-1",
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				inputTokens: 1000,
				outputTokens: 500,
				cost: 0.01,
				currency: "USD",
			});

			optimizer.trackCost({
				jobId: "job-2",
				providerId: "openai",
				modelId: "gpt-4o",
				inputTokens: 1000,
				outputTokens: 500,
				cost: 0.02,
				currency: "USD",
			});

			const summary = optimizer.getSummary({ start: "", end: "", type: "day" });
			expect(summary.byJob["job-1"]).toBe(0.01);
			expect(summary.byJob["job-2"]).toBe(0.02);
		});
	});

	describe("getBudgetStatus", () => {
		it("should return budget status", () => {
			const status = optimizer.getBudgetStatus();
			expect(status.daily).toBeDefined();
			expect(status.weekly).toBeDefined();
			expect(status.monthly).toBeDefined();
			expect(status.exhausted).toBe(false);
		});

		it("should track daily usage", () => {
			optimizer.trackCost({
				jobId: "job-1",
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				inputTokens: 1000,
				outputTokens: 500,
				cost: 5,
				currency: "USD",
			});

			const status = optimizer.getBudgetStatus();
			expect(status.daily.used).toBe(5);
			expect(status.daily.remaining).toBe(5); // $10 budget - $5 used
		});
	});

	describe("canAfford", () => {
		it("should return true for affordable costs", () => {
			expect(optimizer.canAfford(1)).toBe(true);
		});

		it("should return false when budget exhausted", () => {
			// Exhaust daily budget
			for (let i = 0; i < 10; i++) {
				optimizer.trackCost({
					jobId: "job-1",
					providerId: "anthropic",
					modelId: "claude-sonnet-4",
					inputTokens: 1000,
					outputTokens: 500,
					cost: 1.05,
					currency: "USD",
				});
			}

			expect(optimizer.canAfford(1)).toBe(false);
		});
	});

	describe("shouldSwitchToCheaper", () => {
		it("should suggest cheaper alternatives", () => {
			const recommendation = optimizer.shouldSwitchToCheaper(
				{ id: "claude-sonnet-4", providerId: "anthropic" },
				["code_generation"],
			);

			expect(recommendation).not.toBeNull();
			expect(recommendation!.costSavings).toBeGreaterThan(0);
		});

		it("should respect quality loss limit", () => {
			const recommendation = optimizer.shouldSwitchToCheaper(
				{ id: "claude-sonnet-4", providerId: "anthropic" },
				["code_generation"],
				{ maxQualityLoss: 5 },
			);

			if (recommendation) {
				expect(recommendation.qualityImpact).toBeLessThanOrEqual(5);
			}
		});
	});

	describe("forecastCosts", () => {
		it("should forecast costs", () => {
			const requirements: TaskRequirements[] = [
				{
					requiredCapabilities: ["code_generation"],
					minContextWindow: 100000,
					estimatedInputTokens: 5000,
					estimatedOutputTokens: 2000,
				},
				{
					requiredCapabilities: ["code_review"],
					minContextWindow: 100000,
					estimatedInputTokens: 3000,
					estimatedOutputTokens: 1000,
				},
			];

			const forecast = optimizer.forecastCosts(requirements);
			expect(forecast.estimatedTotal).toBeGreaterThan(0);
			expect(forecast.confidence).toBeGreaterThan(0);
			expect(forecast.assumptions.length).toBeGreaterThan(0);
		});
	});

	describe("optimizeModelSelection", () => {
		it("should return optimized selections", () => {
			const requirements: TaskRequirements = {
				requiredCapabilities: ["code_generation"],
				minContextWindow: 100000,
				estimatedInputTokens: 5000,
				estimatedOutputTokens: 2000,
			};

			const selections = optimizer.optimizeModelSelection(
				"task-1",
				requirements,
			);
			expect(selections.length).toBeGreaterThan(0);
			expect(selections[0].model).toBeDefined();
			expect(selections[0].estimatedCost).toBeGreaterThanOrEqual(0);
		});

		it("should filter by requirements", () => {
			const requirements: TaskRequirements = {
				requiredCapabilities: ["code_generation", "vision"],
				minContextWindow: 500000,
				estimatedInputTokens: 5000,
				estimatedOutputTokens: 2000,
			};

			const selections = optimizer.optimizeModelSelection(
				"task-1",
				requirements,
			);
			expect(selections.length).toBeGreaterThan(0);
			// All should have required capabilities
			expect(selections.every((s) => s.model.id !== "MiniMax-Text-01")).toBe(
				true,
			);
		});
	});
});

describe("Utility Functions", () => {
	describe("generateCostId", () => {
		it("should generate unique IDs", () => {
			const id1 = generateCostId();
			const id2 = generateCostId();
			expect(id1).not.toBe(id2);
			expect(id1).toContain("cost_");
		});
	});

	describe("createCostEntry", () => {
		it("should create cost entry with generated id and timestamp", () => {
			const entry = createCostEntry({
				jobId: "job-1",
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				inputTokens: 1000,
				outputTokens: 500,
				cost: 0.005,
				currency: "USD",
			});

			expect(entry.id).toContain("cost_");
			expect(entry.timestamp).toBeDefined();
		});

		it("should use provided id and timestamp", () => {
			const entry = createCostEntry(
				{
					jobId: "job-1",
					providerId: "anthropic",
					modelId: "claude-sonnet-4",
					inputTokens: 1000,
					outputTokens: 500,
					cost: 0.005,
					currency: "USD",
				},
				"custom-id",
				"2024-01-01T00:00:00Z",
			);

			expect(entry.id).toBe("custom-id");
			expect(entry.timestamp).toBe("2024-01-01T00:00:00Z");
		});
	});

	describe("calculateModelCost", () => {
		it("should calculate model cost", () => {
			const cost = calculateModelCost(
				{
					id: "test",
					providerId: "test",
					name: "Test",
					contextWindow: 100000,
					maxOutputTokens: 4096,
					pricing: { inputPer1M: 1, outputPer1M: 2 },
					capabilities: [],
					latency: "fast",
					qualityScore: 80,
				},
				1000000,
				500000,
			);

			expect(cost).toBe(2); // $1 + $1
		});
	});

	describe("quickForecast", () => {
		it("should provide quick forecast", () => {
			const cost = quickForecast(1000, 500);
			expect(cost).toBeGreaterThan(0);
		});
	});

	describe("calculateBudgetStatus", () => {
		it("should calculate budget status", () => {
			const budget: CostBudget = { daily: 10, weekly: 50, monthly: 200 };
			const entries: CostEntry[] = [];
			const status = calculateBudgetStatus(entries, budget);

			expect(status.daily.budget).toBe(10);
			expect(status.weekly.budget).toBe(50);
			expect(status.monthly.budget).toBe(200);
			expect(status.exhausted).toBe(false);
		});
	});

	describe("exceedsBudget", () => {
		it("should detect when cost exceeds budget", () => {
			const budget: CostBudget = { daily: 10 };
			const status = calculateBudgetStatus([], budget);

			expect(exceedsBudget(5, budget, status)).toBe(false);
			expect(exceedsBudget(15, budget, status)).toBe(true);
		});
	});
});

describe("Config", () => {
	describe("DEFAULT_CONFIG", () => {
		it("should have default values", () => {
			expect(DEFAULT_CONFIG.defaultBudget.daily).toBe(10);
			expect(DEFAULT_CONFIG.alertThreshold).toBe(0.8);
		});
	});

	describe("createOptimizerConfig", () => {
		it("should create custom config", () => {
			const overrides = { defaultBudget: { daily: 20 } };
			const config = createOptimizerConfig(overrides);

			expect(config.defaultBudget.daily).toBe(20);
			// Verify weekly is preserved from defaults
			expect(config.defaultBudget.weekly).toBe(50);
		});

		it("should preserve defaults when not overridden", () => {
			const config = createOptimizerConfig({});
			expect(config.defaultBudget.daily).toBe(10);
			expect(config.defaultBudget.weekly).toBe(50);
			expect(config.defaultBudget.monthly).toBe(200);
		});
	});
});
