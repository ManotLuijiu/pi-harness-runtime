/**
 * Provider Adapter SDK - Examples
 *
 * This file demonstrates how to use the Provider Adapter SDK
 * to create, test, and register custom AI provider adapters.
 */

import {
	AdapterBuilder,
	AdapterRegistry,
	AdapterTester,
	type ProviderRequest,
	type ProviderResponse,
} from "../src/index.js";

// ─── Example 1: Creating a Simple Custom Adapter ─────────────────────────────

/**
 * Example of creating a custom provider adapter
 */
async function createCustomAdapter() {
	// Create an adapter using the fluent builder API
	const myAdapter = new AdapterBuilder("My Custom AI")
		.id("my-custom-ai")
		.name("My Custom AI Provider")
		.models("myai/model-x", "myai/model-y", "myai/model-z")
		.capabilities("code", "review", "analysis")
		.rateLimits({
			requestsPerMinute: 60,
			tokensPerMinute: 100000,
		})
		.defaultModel("myai/model-x")
		.maxTokens("myai/model-x", 32768)
		.maxTokens("myai/model-y", 65536)
		.invoke(async (request: ProviderRequest): Promise<ProviderResponse> => {
			// In production, this would call your actual API
			console.log(`Calling API with model: ${request.model}`);

			// Simulate API call
			const response = await fetch(
				"https://api.myai.example.com/v1/completions",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						// "Authorization": `Bearer ${process.env.MYAI_API_KEY}`
					},
					body: JSON.stringify({
						model: request.model,
						messages: request.messages,
						temperature: request.temperature,
						max_tokens: request.maxTokens,
					}),
				},
			);

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`API Error: ${response.status} - ${error}`);
			}

			const data = await response.json();
			return {
				content: data.choices[0]?.message?.content || "",
				model: request.model,
				finishReason: data.choices[0]?.finish_reason || "stop",
				usage: {
					input: data.usage?.prompt_tokens || 0,
					output: data.usage?.completion_tokens || 0,
					cost: data.usage?.total_tokens
						? data.usage.total_tokens * 0.00001
						: 0,
				},
			};
		})
		.parseError((error: unknown) => {
			const e = error as Record<string, unknown>;
			const msg = String(e.message ?? "");
			const status = Number(e.status ?? e.statusCode ?? 0);

			return {
				quotaExceeded: status === 429 || msg.includes("quota"),
				rateLimited: status === 429,
				timeout: status === 408 || msg.includes("timeout"),
				serverError: status >= 500 && status < 600,
				clientError: status >= 400 && status < 500,
				message: msg,
			};
		})
		.healthCheck(async () => {
			try {
				const start = Date.now();
				const response = await fetch("https://api.myai.example.com/health", {
					method: "GET",
					signal: AbortSignal.timeout(5000),
				});
				return {
					healthy: response.ok,
					latencyMs: Date.now() - start,
					message: response.ok ? "OK" : "Service unavailable",
					timestamp: new Date().toISOString(),
				};
			} catch {
				return {
					healthy: false,
					message: "Health check failed",
					timestamp: new Date().toISOString(),
				};
			}
		})
		.build();

	return myAdapter;
}

// ─── Example 2: Using the Registry ───────────────────────────────────────────

/**
 * Example of using the adapter registry
 */
async function useRegistry() {
	// Create registry
	const registry = new AdapterRegistry({
		autoHealthCheck: true,
		healthCheckInterval: 30000,
		healthCheckTimeout: 5000,
	});

	// Create an adapter
	const adapter = await createCustomAdapter();

	// Register with lifecycle hooks
	await registry.register(adapter, {
		async onInit() {
			console.log(`Initializing adapter: ${adapter.id}`);
			// Setup connections, load config, etc.
		},
		async onTeardown() {
			console.log(`Tearing down adapter: ${adapter.id}`);
			// Cleanup resources, close connections, etc.
		},
	});

	// List all adapters
	const allAdapters = registry.listAdapters();
	console.log(`Registered adapters: ${allAdapters.length}`);

	// List by capability
	const codeAdapters = registry.listByCapability("code");
	console.log(`Code-capable adapters: ${codeAdapters.length}`);

	// Invoke adapter
	const result = await registry.invoke(adapter.id, {
		model: "myai/model-x",
		messages: [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Hello!" },
		],
		temperature: 0.7,
		maxTokens: 500,
	});

	console.log(`Response: ${result.response.content}`);

	// Health check
	const health = await registry.healthCheck(adapter.id);
	console.log(`Health: ${health.healthy ? "OK" : "FAIL"}`);

	// Get stats
	const stats = registry.getStats();
	console.log(`Total adapters: ${stats.total}`);
	console.log(`Ready adapters: ${stats.byState.ready}`);

	// Cleanup
	await registry.unregister(adapter.id);
}

// ─── Example 3: Testing Adapters ────────────────────────────────────────────

/**
 * Example of testing an adapter
 */
async function testAdapter() {
	// Create adapter
	const adapter = await createCustomAdapter();

	// Create tester
	const tester = new AdapterTester(adapter, {
		testInvocation: true,
		testQuotaDetection: true,
		testErrorParsing: true,
		testHealthCheck: true,
		testRateLimiting: false,
		mockResponses: true, // Use mock mode for testing
		timeout: 10000,
	});

	// Add custom mock responses
	tester.addMockResponse({
		request: {
			model: "myai/model-x",
			messages: [{ role: "user", content: "Test" }],
		},
		response: {
			content: "This is a mock response",
			model: "myai/model-x",
			finishReason: "stop",
			usage: {
				input: 10,
				output: 20,
				cost: 0.001,
			},
		},
	});

	// Generate default mock responses
	tester.generateMockResponses();

	// Run all tests
	const report = await tester.runAllTests();

	console.log("Test Report:");
	console.log(`  Adapter: ${report.adapterId}`);
	console.log(`  Overall: ${report.overall}`);
	console.log(
		`  Results: ${report.summary.passed}/${report.summary.total} passed`,
	);
	console.log(`  Duration: ${report.summary.duration}ms`);

	for (const result of report.results) {
		const status = result.passed ? "✓" : "✗";
		console.log(
			`    ${status} ${result.name}: ${result.message || result.error}`,
		);
	}

	// Run individual tests
	const invocationResult = await tester.testBasicInvocation({
		model: "myai/model-x",
		messages: [{ role: "user", content: "Hello" }],
	});
	console.log(`Invocation test: ${invocationResult.passed ? "PASS" : "FAIL"}`);

	const errorResult = await tester.testErrorParsing();
	console.log(`Error parsing test: ${errorResult.passed ? "PASS" : "FAIL"}`);

	return report;
}

// ─── Example 4: Error Handling ────────────────────────────────────────────────

/**
 * Example of error handling
 */
async function errorHandling() {
	const adapter = await createCustomAdapter();

	try {
		// Try to invoke with unsupported model
		const result = await adapter.invoke({
			model: "unsupported-model",
			messages: [{ role: "user", content: "Test" }],
		});

		if (result.response.error) {
			console.log(`API Error: ${result.response.error}`);
		}

		if (result.retryable) {
			console.log("Request is retryable");
		}
	} catch (error) {
		const analysis = adapter.parseError(error);
		console.log("Error Analysis:");
		console.log(`  Quota Exceeded: ${analysis.quotaExceeded}`);
		console.log(`  Rate Limited: ${analysis.rateLimited}`);
		console.log(`  Timeout: ${analysis.timeout}`);
		console.log(`  Server Error: ${analysis.serverError}`);
		console.log(`  Client Error: ${analysis.clientError}`);
	}
}

// ─── Example 5: Migration from Existing Adapters ─────────────────────────────

/**
 * Example of migrating an existing adapter
 */
async function migrateExistingAdapter() {
	// This shows how to migrate from the old adapter pattern
	// to the new SDK pattern

	const migratedAdapter = new AdapterBuilder("Legacy Provider")
		.id("legacy-provider")
		.name("Legacy Provider (Migrated)")
		.models("legacy/model-v1", "legacy/model-v2")
		.capabilities("code", "review")
		.rateLimits({
			requestsPerMinute: 30,
			tokensPerDay: 1000000,
		})
		.invoke(async (request: ProviderRequest) => {
			// Your existing invocation logic here
			return {
				content: "Legacy response",
				model: request.model,
				finishReason: "stop",
			};
		})
		// Keep existing error parsing logic
		.parseError((error: unknown) => {
			// Your existing error parsing logic
			return {
				quotaExceeded: false,
				rateLimited: false,
				timeout: false,
				serverError: false,
				clientError: false,
			};
		})
		.build();

	console.log(`Migrated adapter: ${migratedAdapter.id}`);
	return migratedAdapter;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	console.log("Provider Adapter SDK Examples\n");

	console.log("1. Creating a custom adapter...");
	const adapter = await createCustomAdapter();
	console.log(
		`   Created: ${adapter.id} with ${adapter.getModels().length} models`,
	);

	console.log("\n2. Testing the adapter...");
	await testAdapter();

	console.log("\n3. Testing error handling...");
	await errorHandling();

	console.log("\n4. Using the registry...");
	// await useRegistry(); // Uncomment to run full registry example

	console.log("\n5. Migration example...");
	await migrateExistingAdapter();

	console.log("\n✓ All examples completed!");
}

// Run examples
main().catch(console.error);
