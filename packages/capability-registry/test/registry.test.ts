/**
 * Capability Registry Tests (RFC-0051)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	createCapabilityRegistry,
	type InMemoryCapabilityRegistry,
	DEFAULT_CAPABILITIES,
	queryCapabilities,
	findBestModel,
	filterByLatency,
	LATENCY_RANK,
} from "../src/index.js";
import type { CapabilityProfile, Capability } from "../src/types.js";

describe("CapabilityRegistry", () => {
	let registry: InMemoryCapabilityRegistry;

	beforeEach(() => {
		registry = createCapabilityRegistry(true);
	});

	describe("initialization", () => {
		it("should load default capabilities", () => {
			const providers = registry.listProviders();
			expect(providers.length).toBeGreaterThan(0);
		});

		it("should have OpenAI providers", () => {
			const providers = registry.listProviders();
			expect(providers).toContain("openai");
		});

		it("should have Anthropic providers", () => {
			const providers = registry.listProviders();
			expect(providers).toContain("anthropic");
		});
	});

	describe("register and unregister", () => {
		it("should register new capabilities", () => {
			const newCaps: CapabilityProfile[] = [
				{
					capability: "code_generation",
					score: 90,
					latency: "fast",
					contextWindow: 100000,
					maxOutputTokens: 4096,
				},
			];

			registry.register("test-provider", "test-model", newCaps);

			const caps = registry.getCapabilities("test-provider", "test-model");
			expect(caps).toHaveLength(1);
			expect(caps[0].capability).toBe("code_generation");
			expect(caps[0].score).toBe(90);
		});

		it("should unregister capabilities", () => {
			registry.unregister("openai", "gpt-4o");

			const caps = registry.getCapabilities("openai", "gpt-4o");
			expect(caps).toHaveLength(0);
		});

		it("should track events", () => {
			const events: any[] = [];
			registry.onEvent((e) => events.push(e));

			const caps: CapabilityProfile[] = [
				{
					capability: "planning",
					score: 85,
					latency: "fast",
					contextWindow: 50000,
					maxOutputTokens: 2048,
				},
			];

			registry.register("event-test", "model-v1", caps);

			expect(events).toContainEqual({
				type: "capability.registered",
				providerId: "event-test",
				modelId: "model-v1",
				count: 1,
			});
		});
	});

	describe("query", () => {
		it("should query by capability", () => {
			const results = registry.query("code_generation");
			expect(results.length).toBeGreaterThan(0);
		});

		it("should filter by minimum score", () => {
			const results = registry.query("code_generation", { minScore: 95 });
			expect(results.every((r) => r.profile.score >= 95)).toBe(true);
		});

		it("should filter by latency", () => {
			const results = registry.query("code_generation", { maxLatency: "fast" });
			expect(
				results.every(
					(r) => LATENCY_RANK[r.profile.latency] <= LATENCY_RANK["fast"],
				),
			).toBe(true);
		});

		it("should filter by context window", () => {
			const results = registry.query("code_generation", {
				requiresContextWindow: 200000,
			});
			expect(results.every((r) => r.profile.contextWindow >= 200000)).toBe(
				true,
			);
		});

		it("should sort by score descending", () => {
			const results = registry.query("code_generation");
			for (let i = 1; i < results.length; i++) {
				expect(results[i - 1].profile.score).toBeGreaterThanOrEqual(
					results[i].profile.score,
				);
			}
		});

		it("should emit query event", () => {
			const events: any[] = [];
			registry.onEvent((e) => events.push(e));

			registry.query("code_generation");

			expect(events).toContainEqual(
				expect.objectContaining({
					type: "capability.queried",
					capability: "code_generation",
				}),
			);
		});
	});

	describe("listProviders and listModels", () => {
		it("should list providers", () => {
			const providers = registry.listProviders();
			expect(Array.isArray(providers)).toBe(true);
			expect(providers.length).toBeGreaterThan(0);
		});

		it("should list models for a provider", () => {
			const models = registry.listModels("openai");
			expect(models).toContain("gpt-4o");
		});

		it("should return empty array for unknown provider", () => {
			const models = registry.listModels("unknown-provider");
			expect(models).toHaveLength(0);
		});
	});

	describe("findBestModel", () => {
		it("should find the highest scoring model", () => {
			const candidates = registry.query("code_generation");
			const best = findBestModel(candidates);

			expect(best).toBeDefined();
			const maxScore = Math.max(...candidates.map((c) => c.profile.score));
			expect(best!.profile.score).toBe(maxScore);
		});

		it("should return undefined for empty array", () => {
			const result = findBestModel([]);
			expect(result).toBeUndefined();
		});
	});

	describe("filterByLatency", () => {
		it("should filter to fast latency", () => {
			const candidates = registry.query("code_generation");
			const fast = filterByLatency(candidates, "fast");

			expect(fast.every((c) => c.profile.latency === "fast")).toBe(true);
		});

		it("should sort by quality when preference is quality", () => {
			const candidates = registry.query("code_generation");
			const sorted = filterByLatency(candidates, "quality");

			expect(sorted[0].profile.score).toBeGreaterThanOrEqual(
				sorted[1].profile.score,
			);
		});
	});
});

describe("LATENCY_RANK", () => {
	it("should have correct ordering", () => {
		expect(LATENCY_RANK["fast"]).toBeLessThan(LATENCY_RANK["medium"]);
		expect(LATENCY_RANK["medium"]).toBeLessThan(LATENCY_RANK["slow"]);
	});
});
