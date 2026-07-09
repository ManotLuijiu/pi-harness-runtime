/**
 * Provider Adapter SDK - Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	createProviderBuilder,
	createAdapterRegistry,
	createAdapterTester,
	AdapterBuilder,
	AdapterRegistry,
	AdapterTester,
	SDK_VERSION,
} from "../src/index.js";
import type { ProviderAdapter } from "../src/types.js";

describe("ProviderAdapterSDK", () => {
	describe("SDK_VERSION", () => {
		it("should export SDK_VERSION", () => {
			expect(SDK_VERSION).toBeDefined();
			expect(typeof SDK_VERSION).toBe("string");
		});
	});

	describe("createProviderBuilder", () => {
		it("should create a provider builder instance", () => {
			const builder = createProviderBuilder("test-provider");
			expect(builder).toBeInstanceOf(AdapterBuilder);
		});

		it("should configure provider with complete method", () => {
			const builder = createProviderBuilder("test-provider");
			const adapter = builder
				.id("test-adapter")
				.complete(async (prompt) => ({ content: `Response to: ${prompt}` }))
				.build();

			expect(adapter).toBeDefined();
			expect(adapter.name).toBe("test-provider");
			expect(adapter.id).toBe("test-adapter");
		});

		it("should configure with invoke method", () => {
			const builder = createProviderBuilder("invoke-provider");
			const adapter = builder
				.id("invoke-adapter")
				.invoke(async () => ({ content: "test response" }))
				.build();

			expect(adapter).toBeDefined();
		});

		it("should set models", () => {
			const builder = createProviderBuilder("multi-model");
			const adapter = builder
				.id("multi-model-adapter")
				.models("gpt-4", "gpt-3.5")
				.complete(async () => ({ content: "test" }))
				.build();

			expect(adapter.getModels()).toContain("gpt-4");
			expect(adapter.getModels()).toContain("gpt-3.5");
		});

		it("should set capabilities", () => {
			const builder = createProviderBuilder("capable-adapter");
			const adapter = builder
				.id("capable")
				.capabilities("code", "review")
				.complete(async () => ({ content: "test" }))
				.build();

			expect(adapter.getCapabilities()).toContain("code");
			expect(adapter.getCapabilities()).toContain("review");
		});

		it("should throw on build without id", () => {
			const builder = createProviderBuilder("no-id");
			expect(() =>
				builder.complete(async () => ({ content: "test" })).build(),
			).toThrow();
		});
	});

	describe("createAdapterRegistry", () => {
		let registry: AdapterRegistry;

		beforeEach(() => {
			registry = createAdapterRegistry();
		});

		it("should create an adapter registry instance", () => {
			expect(registry).toBeInstanceOf(AdapterRegistry);
		});

		it("should register and retrieve adapters", async () => {
			const adapter: ProviderAdapter = {
				name: "test-adapter",
				provider: "openai",
				complete: async () => ({ content: "test" }),
			};

			await registry.register(adapter);
			const retrieved = registry.get("test-adapter");

			expect(retrieved).toBeDefined();
		});

		it("should list all registered adapters", async () => {
			const adapter1: ProviderAdapter = {
				name: "adapter-1",
				provider: "openai",
				complete: async () => ({ content: "test1" }),
			};

			const adapter2: ProviderAdapter = {
				name: "adapter-2",
				provider: "anthropic",
				complete: async () => ({ content: "test2" }),
			};

			await registry.register(adapter1);
			await registry.register(adapter2);

			const all = registry.listAll();
			expect(all.length).toBeGreaterThanOrEqual(2);
		});

		it("should unregister adapters", async () => {
			const adapter: ProviderAdapter = {
				name: "removable",
				provider: "openai",
				complete: async () => ({ content: "test" }),
			};

			await registry.register(adapter);
			expect(registry.get("removable")).toBeDefined();

			await registry.unregister("removable");
			expect(registry.get("removable")).toBeUndefined();
		});

		it("should check if adapter exists", async () => {
			const adapter: ProviderAdapter = {
				name: "checkable",
				provider: "openai",
				complete: async () => ({ content: "test" }),
			};

			await registry.register(adapter);
			expect(registry.has("checkable")).toBe(true);
			expect(registry.has("non-existent")).toBe(false);
		});

		it("should throw on duplicate registration", async () => {
			const adapter: ProviderAdapter = {
				name: "duplicate",
				provider: "openai",
				complete: async () => ({ content: "test" }),
			};

			await registry.register(adapter);
			await expect(registry.register(adapter)).rejects.toThrow();
		});
	});

	describe("createAdapterTester", () => {
		it("should create an adapter tester instance", () => {
			const tester = createAdapterTester({} as any);
			expect(tester).toBeInstanceOf(AdapterTester);
		});
	});

	describe("AdapterBuilder", () => {
		it("should build adapter with configuration", () => {
			const builder = createProviderBuilder("configured-adapter");

			const adapter = builder
				.id("configured")
				.complete(async (prompt) => ({ content: `Config: ${prompt}` }))
				.build();

			expect(adapter).toBeDefined();
		});

		it("should validate required methods", () => {
			const builder = createProviderBuilder("incomplete");

			expect(() => builder.build()).toThrow();
		});
	});

	describe("BuiltAdapter", () => {
		it("should have invoke method", async () => {
			const builder = createProviderBuilder("invoke-test");
			const adapter = builder
				.id("invoke-test")
				.complete(async () => ({ content: "hello" }))
				.build();

			const result = await adapter.invoke({
				model: "test",
				messages: [{ role: "user", content: "test" }],
			});

			expect(result.response.content).toBe("hello");
		});

		it("should parse errors", () => {
			const builder = createProviderBuilder("error-test");
			const adapter = builder
				.id("error-test")
				.complete(async () => ({ content: "test" }))
				.build();

			const error = adapter.parseError(new Error("rate limit exceeded"));
			expect(error).toBeDefined();
		});
	});
});
