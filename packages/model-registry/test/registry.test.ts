/**
 * Model Registry Tests (RFC-0053)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	createModelRegistry,
	type InMemoryModelRegistry,
	DEFAULT_MODELS,
	findModels,
	getCheapestModel,
	getLargestContextModel,
	filterByCostEfficiency,
	calculateCost,
	getCostPer1M,
	calculateSavings,
} from "../src/index.js";
import type { ModelInfo } from "../src/types.js";

describe("ModelRegistry", () => {
	let registry: InMemoryModelRegistry;

	beforeEach(() => {
		registry = createModelRegistry(true);
	});

	describe("initialization", () => {
		it("should load default models", () => {
			const models = registry.list();
			expect(models.length).toBeGreaterThan(0);
		});

		it("should have OpenAI models", () => {
			const models = registry.list("openai");
			expect(models.length).toBeGreaterThan(0);
		});

		it("should have Anthropic models", () => {
			const models = registry.list("anthropic");
			expect(models.length).toBeGreaterThan(0);
		});

		it("should have MiniMax models", () => {
			const models = registry.list("minimax");
			expect(models.length).toBeGreaterThan(0);
		});
	});

	describe("register and unregister", () => {
		it("should register a new model", () => {
			const newModel: ModelInfo = {
				id: "test-model",
				providerId: "test-provider",
				name: "Test Model",
				contextWindow: 100000,
				maxOutputTokens: 4096,
				pricing: {
					currency: "USD",
					inputPer1M: 0.5,
					outputPer1M: 1.0,
				},
				capabilities: ["code_generation"],
				aliases: ["test", "test-model-v1"],
				status: "active",
			};

			registry.register(newModel);

			const retrieved = registry.get("test-provider", "test-model");
			expect(retrieved).toBeDefined();
			expect(retrieved!.name).toBe("Test Model");
		});

		it("should unregister a model", () => {
			registry.unregister("openai", "gpt-4o");

			const retrieved = registry.get("openai", "gpt-4o");
			expect(retrieved).toBeUndefined();
		});

		it("should track events", () => {
			const events: any[] = [];
			registry.onEvent((e) => events.push(e));

			const newModel: ModelInfo = {
				id: "event-test",
				providerId: "test",
				name: "Event Test",
				contextWindow: 50000,
				maxOutputTokens: 2048,
				pricing: { currency: "USD", inputPer1M: 1, outputPer1M: 2 },
				capabilities: [],
				aliases: [],
				status: "active",
			};

			registry.register(newModel);

			expect(events).toContainEqual({
				type: "model.registered",
				providerId: "test",
				modelId: "event-test",
			});
		});
	});

	describe("get and getByAlias", () => {
		it("should get model by provider and ID", () => {
			const model = registry.get("anthropic", "claude-sonnet-4");
			expect(model).toBeDefined();
			expect(model!.name).toBe("Claude Sonnet 4");
		});

		it("should get model by alias", () => {
			const model = registry.getByAlias("sonnet");
			expect(model).toBeDefined();
			expect(model!.id).toBe("claude-sonnet-4");
		});

		it("should return undefined for unknown alias", () => {
			const model = registry.getByAlias("unknown-model");
			expect(model).toBeUndefined();
		});
	});

	describe("list and listActive", () => {
		it("should list all models", () => {
			const models = registry.list();
			expect(models.length).toBe(DEFAULT_MODELS.length);
		});

		it("should list models by provider", () => {
			const models = registry.list("openai");
			expect(models.every((m) => m.providerId === "openai")).toBe(true);
		});

		it("should list only active models", () => {
			const active = registry.listActive();
			expect(active.every((m) => m.status === "active")).toBe(true);
		});
	});

	describe("find", () => {
		it("should find by provider", () => {
			const models = registry.find({ providerId: "openai" });
			expect(models.every((m) => m.providerId === "openai")).toBe(true);
		});

		it("should find by minimum context window", () => {
			const models = registry.find({ minContextWindow: 200000 });
			expect(models.every((m) => m.contextWindow >= 200000)).toBe(true);
		});

		it("should find by max cost", () => {
			const models = registry.find({ maxCostPer1M: 5 });
			expect(models.every((m) => getCostPer1M(m.pricing) <= 5)).toBe(true);
		});

		it("should find by capabilities", () => {
			const models = registry.find({ capabilities: ["vision"] });
			expect(models.every((m) => m.capabilities.includes("vision"))).toBe(true);
		});

		it("should find by status", () => {
			const models = registry.find({ status: "active" });
			expect(models.every((m) => m.status === "active")).toBe(true);
		});

		it("should sort by cost ascending", () => {
			const models = registry.find({});
			for (let i = 1; i < models.length; i++) {
				expect(getCostPer1M(models[i - 1].pricing)).toBeLessThanOrEqual(
					getCostPer1M(models[i].pricing),
				);
			}
		});

		it("should emit query event", () => {
			const events: any[] = [];
			registry.onEvent((e) => events.push(e));

			registry.find({ providerId: "openai" });

			expect(events).toContainEqual(
				expect.objectContaining({
					type: "model.queried",
					filters: { providerId: "openai" },
				}),
			);
		});
	});

	describe("updateStatus", () => {
		it("should update model status", () => {
			registry.updateStatus("openai", "gpt-4o", "deprecated");

			const model = registry.get("openai", "gpt-4o");
			expect(model!.status).toBe("deprecated");
			expect(model!.deprecatedAt).toBeDefined();
		});

		it("should emit status change event", () => {
			const events: any[] = [];
			registry.onEvent((e) => events.push(e));

			registry.updateStatus("openai", "gpt-4o", "disabled");

			expect(events).toContainEqual(
				expect.objectContaining({
					type: "model.status_changed",
					providerId: "openai",
					modelId: "gpt-4o",
					status: "disabled",
				}),
			);
		});
	});
});

describe("Cost Functions", () => {
	describe("calculateCost", () => {
		it("should calculate basic cost", () => {
			const model: ModelInfo = {
				id: "test",
				providerId: "test",
				name: "Test",
				contextWindow: 100000,
				maxOutputTokens: 4096,
				pricing: { currency: "USD", inputPer1M: 1, outputPer1M: 2 },
				capabilities: [],
				aliases: [],
				status: "active",
			};

			// 1M input, 500k output
			const cost = calculateCost(model, 1_000_000, 500_000);
			expect(cost).toBe(2); // $1 + $1
		});

		it("should apply batch discount", () => {
			const model: ModelInfo = {
				id: "test",
				providerId: "test",
				name: "Test",
				contextWindow: 100000,
				maxOutputTokens: 4096,
				pricing: {
					currency: "USD",
					inputPer1M: 1,
					outputPer1M: 2,
					batchInputPer1M: 0.1,
				},
				capabilities: [],
				aliases: [],
				status: "active",
			};

			const withBatch = calculateCost(model, 1_000_000, 0, { useBatch: true });
			const withoutBatch = calculateCost(model, 1_000_000, 0);

			expect(withBatch).toBeLessThan(withoutBatch);
		});
	});

	describe("getCostPer1M", () => {
		it("should sum input and output costs", () => {
			const cost = getCostPer1M({
				currency: "USD",
				inputPer1M: 1,
				outputPer1M: 2,
			});
			expect(cost).toBe(3);
		});
	});

	describe("calculateSavings", () => {
		it("should calculate absolute and percentage savings", () => {
			const current: ModelInfo = {
				id: "current",
				providerId: "test",
				name: "Current",
				contextWindow: 100000,
				maxOutputTokens: 4096,
				pricing: { currency: "USD", inputPer1M: 1, outputPer1M: 2 },
				capabilities: [],
				aliases: [],
				status: "active",
			};

			const cheaper: ModelInfo = {
				id: "cheaper",
				providerId: "test",
				name: "Cheaper",
				contextWindow: 100000,
				maxOutputTokens: 4096,
				pricing: { currency: "USD", inputPer1M: 0.5, outputPer1M: 1 },
				capabilities: [],
				aliases: [],
				status: "active",
			};

			const savings = calculateSavings(current, cheaper, 1_000_000, 500_000);
			// current: 1M@$1 + 0.5M@$2 = $2
			// cheaper: 1M@$0.5 + 0.5M@$1 = $1
			// savings: $2 - $1 = $1
			expect(savings.absolute).toBe(1);
			expect(savings.percentage).toBe(50); // 50%
		});
	});
});

describe("Query Functions", () => {
	let models: ModelInfo[];

	beforeEach(() => {
		const registry = createModelRegistry(true);
		models = registry.list();
	});

	describe("getCheapestModel", () => {
		it("should return the cheapest model", () => {
			const cheapest = getCheapestModel(models);
			expect(cheapest).toBeDefined();
		});
	});

	describe("getLargestContextModel", () => {
		it("should return the model with largest context", () => {
			const largest = getLargestContextModel(models);
			expect(largest).toBeDefined();
			const maxWindow = Math.max(...models.map((m) => m.contextWindow));
			expect(largest!.contextWindow).toBe(maxWindow);
		});
	});

	describe("filterByCostEfficiency", () => {
		it("should sort by cost per context", () => {
			const sorted = filterByCostEfficiency(models);
			expect(sorted.length).toBe(models.length);
		});
	});
});
