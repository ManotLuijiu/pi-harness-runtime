/**
 * Provider Adapter SDK - Tests
 *
 * Simple test file using Node.js assertions
 */

import { equal, ok, throws, deepEqual, strictEqual } from "assert";
import {
	AdapterBuilder,
	AdapterRegistry,
	AdapterTester,
	SDK_VERSION,
	AdapterNotFoundError,
	AdapterAlreadyRegisteredError,
	BuilderValidationError,
} from "../src/index.js";

async function runTests() {
	console.log("Running Provider Adapter SDK Tests...\n");
	let passed = 0;
	let failed = 0;

	function test(name: string, fn: () => void | Promise<void>) {
		try {
			const result = fn();
			if (result instanceof Promise) {
				result
					.then(() => {
						console.log(`✓ ${name}`);
						passed++;
					})
					.catch((e) => {
						console.log(`✗ ${name}: ${e.message}`);
						failed++;
					});
			} else {
				console.log(`✓ ${name}`);
				passed++;
			}
		} catch (e) {
			console.log(`✗ ${name}: ${(e as Error).message}`);
			failed++;
		}
	}

	// ─── AdapterBuilder Tests ────────────────────────────────────────────────

	test("should create an adapter with required fields", () => {
		const adapter = new AdapterBuilder("Test Provider")
			.id("test-provider")
			.models("test-model-v1")
			.invoke(async (request) => ({
				content: `Response for ${request.model}`,
				model: request.model,
				finishReason: "stop",
			}))
			.build();

		equal(adapter.id, "test-provider");
		equal(adapter.name, "Test Provider");
		ok(adapter.getModels().includes("test-model-v1"));
	});

	test("should set capabilities", () => {
		const adapter = new AdapterBuilder("Test Provider")
			.id("test-capabilities")
			.models("model-1")
			.capabilities("code", "review", "test")
			.invoke(async () => ({
				content: "test",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		deepEqual(adapter.getCapabilities(), ["code", "review", "test"]);
	});

	test("should set default model", () => {
		const adapter = new AdapterBuilder("Test Provider")
			.id("test-default")
			.models("model-a", "model-b")
			.defaultModel("model-b")
			.invoke(async () => ({
				content: "test",
				model: "model-b",
				finishReason: "stop",
			}))
			.build();

		equal(adapter.getDefaultModel(), "model-b");
	});

	test("should set max tokens per model", () => {
		const adapter = new AdapterBuilder("Test Provider")
			.id("test-tokens")
			.models("model-x")
			.maxTokens("model-x", 100000)
			.invoke(async () => ({
				content: "test",
				model: "model-x",
				finishReason: "stop",
			}))
			.build();

		equal(adapter.getMaxTokens("model-x"), 100000);
	});

	test("should throw on missing required fields", () => {
		throws(() => {
			new AdapterBuilder("Test")
				.models("model-1")
				.invoke(async () => ({ content: "", model: "", finishReason: "stop" }))
				.build();
		}, BuilderValidationError);
	});

	test("should throw on missing invoke function", () => {
		throws(() => {
			new AdapterBuilder("Test")
				.id("test-missing-invoke")
				.models("model-1")
				.build();
		}, BuilderValidationError);
	});

	test("should use default error parser", () => {
		const adapter = new AdapterBuilder("Test")
			.id("test-error-parser")
			.models("model-1")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		const result = adapter.parseError({
			message: "Rate limit exceeded",
			code: "429",
		});

		equal(result.rateLimited, true);
	});

	test("should support custom error parser", () => {
		const adapter = new AdapterBuilder("Test")
			.id("test-custom-parser")
			.models("model-1")
			.parseError(() => ({
				quotaExceeded: true,
				rateLimited: false,
				timeout: false,
				serverError: false,
				clientError: false,
			}))
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		const result = adapter.parseError(new Error("test"));
		equal(result.quotaExceeded, true);
	});

	test("should support model checking", () => {
		const adapter = new AdapterBuilder("Test")
			.id("test-model-check")
			.models("model-a", "model-b")
			.invoke(async () => ({ content: "", model: "", finishReason: "stop" }))
			.build();

		equal(adapter.supportsModel("model-a"), true);
		equal(adapter.supportsModel("model-b"), true);
		equal(adapter.supportsModel("model-c"), false);
	});

	test("should track SDK version", () => {
		equal(SDK_VERSION, "1.0.0");
	});

	// ─── AdapterRegistry Tests ───────────────────────────────────────────────

	test("should register an adapter", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-reg-${Date.now()}`)
			.models("model-1")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		const info = await registry.register(adapter);
		equal(info.id, adapter.id);
		equal(info.state, "ready");
	});

	test("should throw when registering duplicate adapter", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-dup-${Date.now()}`)
			.models("model-1")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		await registry.register(adapter);

		try {
			await registry.register(adapter);
			throw new Error("Should have thrown");
		} catch (e) {
			if (!(e instanceof AdapterAlreadyRegisteredError)) {
				throw e;
			}
		}
	});

	test("should get registered adapter", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-get-${Date.now()}`)
			.models("model-1")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		await registry.register(adapter);
		const retrieved = registry.getAdapter(adapter.id);
		equal(retrieved?.id, adapter.id);
	});

	test("should throw when getting non-existent adapter", async () => {
		const registry = new AdapterRegistry();

		try {
			await registry.getAdapter("non-existent");
			throw new Error("Should have thrown");
		} catch (e) {
			if (!(e instanceof AdapterNotFoundError)) {
				throw e;
			}
		}
	});

	test("should list all adapters", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-list-${Date.now()}`)
			.models("model-1")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		await registry.register(adapter);
		const adapters = registry.listAdapters();
		ok(adapters.length > 0);
	});

	test("should list adapters by capability", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-cap-${Date.now()}`)
			.models("model-1")
			.capabilities("code")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		await registry.register(adapter);
		const codeAdapters = registry.listByCapability("code");
		ok(codeAdapters.length > 0);
	});

	test("should unregister an adapter", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-unreg-${Date.now()}`)
			.models("model-1")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		await registry.register(adapter);
		await registry.unregister(adapter.id);
		strictEqual(registry.getAdapter(adapter.id), undefined);
	});

	test("should invoke adapter through registry", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-invoke-${Date.now()}`)
			.models("model-1")
			.invoke(async (request) => ({
				content: `Response for ${request.model}`,
				model: request.model,
				finishReason: "stop",
			}))
			.build();

		await registry.register(adapter);
		const result = await registry.invoke(adapter.id, {
			model: "model-1",
			messages: [{ role: "user", content: "Hello" }],
		});
		ok(result.response.content.includes("model-1"));
	});

	test("should health check adapter", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-health-${Date.now()}`)
			.models("model-1")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		await registry.register(adapter);
		const result = await registry.healthCheck(adapter.id);
		equal(result.healthy, true);
	});

	test("should get registry stats", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-stats-${Date.now()}`)
			.models("model-1")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		await registry.register(adapter);
		const stats = registry.getStats();
		ok(stats.total > 0);
	});

	test("should support capability checking", async () => {
		const registry = new AdapterRegistry();
		const adapter = new AdapterBuilder("Test")
			.id(`test-cap-check-${Date.now()}`)
			.models("model-1")
			.capabilities("code")
			.invoke(async () => ({
				content: "",
				model: "model-1",
				finishReason: "stop",
			}))
			.build();

		await registry.register(adapter);
		equal(registry.supportsCapability("code"), true);
		equal(
			registry.supportsCapability(
				"review" as Parameters<typeof registry.supportsCapability>[0],
			),
			false,
		);
	});

	// ─── AdapterTester Tests ─────────────────────────────────────────────────

	test("should run all tests in mock mode", async () => {
		const adapter = new AdapterBuilder("Test")
			.id(`test-run-${Date.now()}`)
			.models("test-model")
			.capabilities("code", "review")
			.healthCheck(async () => ({
				healthy: true,
				timestamp: new Date().toISOString(),
			}))
			.invoke(async () => ({
				content: "Test response",
				model: "test-model",
				finishReason: "stop",
			}))
			.build();

		const tester = new AdapterTester(adapter, { mockResponses: true });
		const report = await tester.runAllTests();

		equal(report.adapterId, adapter.id);
		ok(report.results.length > 0);
		equal(report.summary.total, report.results.length);
	});

	test("should test model availability", async () => {
		const adapter = new AdapterBuilder("Test")
			.id(`test-model-avail-${Date.now()}`)
			.models("test-model")
			.invoke(async () => ({
				content: "",
				model: "test-model",
				finishReason: "stop",
			}))
			.build();

		const tester = new AdapterTester(adapter, { mockResponses: true });
		const result = await tester.testModelAvailability("test-model");

		equal(result.name, "model_availability");
		equal(result.passed, true);
	});

	test("should test error parsing", async () => {
		const adapter = new AdapterBuilder("Test")
			.id(`test-err-parsing-${Date.now()}`)
			.models("test-model")
			.invoke(async () => ({
				content: "",
				model: "test-model",
				finishReason: "stop",
			}))
			.build();

		const tester = new AdapterTester(adapter, { mockResponses: true });
		const result = await tester.testErrorParsing();

		equal(result.name, "error_parsing");
		equal(result.passed, true);
	});

	test("should test health check", async () => {
		const adapter = new AdapterBuilder("Test")
			.id(`test-health-check-${Date.now()}`)
			.models("test-model")
			.healthCheck(async () => ({
				healthy: true,
				timestamp: new Date().toISOString(),
			}))
			.invoke(async () => ({
				content: "",
				model: "test-model",
				finishReason: "stop",
			}))
			.build();

		const tester = new AdapterTester(adapter, { mockResponses: true });
		const result = await tester.testHealthCheck();

		equal(result.name, "health_check");
		equal(result.passed, true);
	});

	test("should generate mock responses", async () => {
		const adapter = new AdapterBuilder("Test")
			.id(`test-mock-gen-${Date.now()}`)
			.models("model-a", "model-b")
			.invoke(async () => ({
				content: "",
				model: "model-a",
				finishReason: "stop",
			}))
			.build();

		const tester = new AdapterTester(adapter);
		tester.generateMockResponses();
		ok(
			(tester as unknown as { mockResponses: unknown[] }).mockResponses.length >
				0,
		);
	});

	test("should add and clear mock responses", async () => {
		const adapter = new AdapterBuilder("Test")
			.id(`test-mock-clear-${Date.now()}`)
			.models("test-model")
			.invoke(async () => ({
				content: "",
				model: "test-model",
				finishReason: "stop",
			}))
			.build();

		const tester = new AdapterTester(adapter);
		tester.addMockResponse({
			request: { model: "test", messages: [] },
			response: { content: "mock", model: "test", finishReason: "stop" },
		});
		equal(
			(tester as unknown as { mockResponses: unknown[] }).mockResponses.length,
			1,
		);

		tester.clearMockResponses();
		equal(
			(tester as unknown as { mockResponses: unknown[] }).mockResponses.length,
			0,
		);
	});

	// Wait for async tests to complete
	await new Promise((resolve) => setTimeout(resolve, 100));

	console.log(`\n${"─".repeat(50)}`);
	console.log(`Tests: ${passed} passed, ${failed} failed`);
	console.log(`${"─".repeat(50)}`);

	if (failed > 0) {
		process.exit(1);
	}
}

runTests().catch((e) => {
	console.error("Test runner failed:", e);
	process.exit(1);
});
