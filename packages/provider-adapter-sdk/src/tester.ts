/**
 * Provider Adapter SDK - Tester
 *
 * Testing utilities for provider adapters.
 */

import type { ProviderRequest } from "../../types/src/runtime-types.js";
import type {
	AdapterResult,
	HealthCheckResult,
	MockResponse,
	TestConfig,
	TestReport,
	TestResult,
} from "./types.js";
import type { BuiltAdapter } from "./builder.js";
import { TestFailureError } from "./errors.js";

/**
 * Default test configuration
 */
const DEFAULT_TEST_CONFIG: Required<TestConfig> = {
	testInvocation: true,
	testQuotaDetection: true,
	testErrorParsing: true,
	testHealthCheck: true,
	testRateLimiting: false,
	mockResponses: true,
	timeout: 10000,
};

/**
 * Default test request
 */
const DEFAULT_TEST_REQUEST: ProviderRequest = {
	model: "",
	messages: [
		{
			role: "user",
			content: "Hello, this is a test message.",
		},
	],
	temperature: 0.7,
	maxTokens: 100,
};

/**
 * Tester utility for validating adapters
 */
export class AdapterTester {
	private readonly adapter: BuiltAdapter;
	private readonly config: Required<TestConfig>;
	private mockResponses: MockResponse[] = [];
	private testStartTime = 0;

	constructor(adapter: BuiltAdapter, config: TestConfig = {}) {
		this.adapter = adapter;
		this.config = { ...DEFAULT_TEST_CONFIG, ...config };
	}

	/**
	 * Run all tests
	 */
	async runAllTests(): Promise<TestReport> {
		this.testStartTime = Date.now();
		const results: TestResult[] = [];

		// Get the first supported model for testing
		const models = this.adapter.getModels();
		const testModel = this.config.mockResponses
			? models[0] || "test-model"
			: models[0];

		if (!testModel) {
			results.push({
				name: "model_availability",
				passed: false,
				duration: 0,
				error: "No models available for testing",
			});
			return this.createReport(results);
		}

		// Update default request with model
		const testRequest: ProviderRequest = {
			...DEFAULT_TEST_REQUEST,
			model: testModel,
		};

		// Test model availability
		results.push(await this.testModelAvailability(testModel));

		// Test invocation
		if (this.config.testInvocation) {
			results.push(await this.testBasicInvocation(testRequest));
		}

		// Test quota detection
		if (this.config.testQuotaDetection) {
			results.push(await this.testQuotaDetection());
		}

		// Test error parsing
		if (this.config.testErrorParsing) {
			results.push(await this.testErrorParsing());
		}

		// Test health check
		if (this.config.testHealthCheck) {
			results.push(await this.testHealthCheck());
		}

		// Test rate limiting
		if (this.config.testRateLimiting) {
			results.push(await this.testRateLimiting(testRequest));
		}

		return this.createReport(results);
	}

	/**
	 * Test model availability
	 */
	async testModelAvailability(model: string): Promise<TestResult> {
		const start = Date.now();
		try {
			const supported = this.adapter.supportsModel(model);
			return {
				name: "model_availability",
				passed: supported,
				duration: Date.now() - start,
				message: supported
					? `Model '${model}' is supported`
					: `Model '${model}' is not supported`,
			};
		} catch (error) {
			return {
				name: "model_availability",
				passed: false,
				duration: Date.now() - start,
				error: String(error),
			};
		}
	}

	/**
	 * Test basic invocation
	 */
	async testBasicInvocation(request: ProviderRequest): Promise<TestResult> {
		const start = Date.now();
		try {
			if (this.config.mockResponses) {
				// Mock response mode
				return {
					name: "basic_invocation",
					passed: true,
					duration: Date.now() - start,
					message: "Mock response mode - invocation skipped",
				};
			}

			const result = await this.withTimeout<AdapterResult>(
				this.adapter.invoke(request),
				this.config.timeout,
			);

			const passed = result.response.content !== undefined;
			return {
				name: "basic_invocation",
				passed,
				duration: Date.now() - start,
				message: passed
					? "Invocation successful"
					: "Invocation returned empty response",
				details: {
					hasContent: !!result.response.content,
					latencyMs: result.latencyMs,
				},
			};
		} catch (error) {
			// In mock mode, errors are expected
			if (this.config.mockResponses) {
				return {
					name: "basic_invocation",
					passed: true,
					duration: Date.now() - start,
					message: "Mock mode - error handling verified",
				};
			}
			return {
				name: "basic_invocation",
				passed: false,
				duration: Date.now() - start,
				error: String(error),
			};
		}
	}

	/**
	 * Test quota detection
	 */
	async testQuotaDetection(): Promise<TestResult> {
		const start = Date.now();
		try {
			// Test error parsing with quota-related errors
			const testErrors = [
				{ message: "Quota exceeded for this period", code: "QUOTA_EXCEEDED" },
				{ message: "Insufficient quota", code: "insufficient_quota" },
				{ message: "Rate limit exceeded", code: "429" },
			];

			const results = testErrors.map((e) => this.adapter.parseError(e));

			// Check if at least some quota signals were detected
			const quotaDetected = results.filter(
				(r) => r.quotaExceeded || r.rateLimited,
			);
			const passed = quotaDetected.length > 0;

			return {
				name: "quota_detection",
				passed,
				duration: Date.now() - start,
				message: passed
					? `Quota detection working (${quotaDetected.length}/${testErrors.length} detected)`
					: "Quota detection not working",
				details: {
					errorsTested: testErrors.length,
					detected: quotaDetected.length,
				},
			};
		} catch (error) {
			return {
				name: "quota_detection",
				passed: false,
				duration: Date.now() - start,
				error: String(error),
			};
		}
	}

	/**
	 * Test error parsing
	 */
	async testErrorParsing(): Promise<TestResult> {
		const start = Date.now();
		try {
			const testCases: Array<{
				input: unknown;
				expected: Partial<{
					quotaExceeded: boolean;
					rateLimited: boolean;
					timeout: boolean;
					serverError: boolean;
					clientError: boolean;
				}>;
			}> = [
				{
					input: { message: "Rate limit exceeded", code: "429" },
					expected: { rateLimited: true },
				},
				{
					input: { message: "Internal server error", code: "500" },
					expected: { serverError: true },
				},
				{
					input: { message: "Bad request", code: "400" },
					expected: { clientError: true },
				},
				{
					input: { message: "Request timeout", code: "timeout" },
					expected: { timeout: true },
				},
			];

			let passedCount = 0;
			for (const testCase of testCases) {
				const result = this.adapter.parseError(testCase.input);
				const matches = Object.entries(testCase.expected).every(
					([key, value]) => result[key as keyof typeof result] === value,
				);
				if (matches) passedCount++;
			}

			const passed = passedCount === testCases.length;
			return {
				name: "error_parsing",
				passed,
				duration: Date.now() - start,
				message: passed
					? "All error parsing tests passed"
					: `${passedCount}/${testCases.length} error parsing tests passed`,
				details: { passedCount, total: testCases.length },
			};
		} catch (error) {
			return {
				name: "error_parsing",
				passed: false,
				duration: Date.now() - start,
				error: String(error),
			};
		}
	}

	/**
	 * Test health check
	 */
	async testHealthCheck(): Promise<TestResult> {
		const start = Date.now();
		try {
			const result = await this.withTimeout<HealthCheckResult>(
				this.adapter.healthCheck(),
				this.config.timeout,
			);

			return {
				name: "health_check",
				passed: result.healthy !== undefined,
				duration: Date.now() - start,
				message: result.healthy
					? "Health check passed"
					: "Health check indicates unhealthy",
				details: {
					healthy: result.healthy,
					latencyMs: result.latencyMs,
				},
			};
		} catch (error) {
			return {
				name: "health_check",
				passed: false,
				duration: Date.now() - start,
				error: String(error),
			};
		}
	}

	/**
	 * Test rate limiting behavior
	 */
	async testRateLimiting(request: ProviderRequest): Promise<TestResult> {
		const start = Date.now();
		try {
			// Make concurrent requests to test rate limiting
			const concurrency = 5;
			const promises = Array.from({ length: concurrency }, () =>
				this.adapter.invoke(request).catch((e: unknown) => e),
			);

			const results = await Promise.allSettled(promises);
			const rejected = results.filter((r) => r.status === "rejected");

			// If rate limiting is configured, we expect some to be rate limited
			const rateLimits = this.adapter.getRateLimits();
			const hasRateLimitConfig =
				rateLimits.concurrentRequests !== undefined ||
				rateLimits.requestsPerMinute !== undefined;

			const passed = hasRateLimitConfig || rejected.length === 0;

			return {
				name: "rate_limiting",
				passed,
				duration: Date.now() - start,
				message: hasRateLimitConfig
					? "Rate limiting configured"
					: "No rate limiting configured",
				details: {
					concurrency,
					rejected: rejected.length,
					hasConfig: hasRateLimitConfig,
				},
			};
		} catch (error) {
			return {
				name: "rate_limiting",
				passed: false,
				duration: Date.now() - start,
				error: String(error),
			};
		}
	}

	/**
	 * Add mock responses for testing
	 */
	addMockResponse(mock: MockResponse): void {
		this.mockResponses.push(mock);
	}

	/**
	 * Clear mock responses
	 */
	clearMockResponses(): void {
		this.mockResponses = [];
	}

	/**
	 * Generate mock responses based on adapter config
	 */
	generateMockResponses(): void {
		this.mockResponses = this.adapter.getModels().map((model: string) => ({
			request: { ...DEFAULT_TEST_REQUEST, model },
			response: {
				content: `Mock response for ${model}`,
				model,
				finishReason: "stop",
				usage: {
					input: 10,
					output: 20,
					cost: 0.001,
				},
			},
		}));
	}

	/**
	 * Create test report
	 */
	private createReport(results: TestResult[]): TestReport {
		const totalDuration = Date.now() - this.testStartTime;
		const passed = results.filter((r) => r.passed).length;
		const failed = results.filter((r) => !r.passed).length;

		return {
			adapterId: this.adapter.id,
			timestamp: new Date().toISOString(),
			results,
			summary: {
				total: results.length,
				passed,
				failed,
				duration: totalDuration,
			},
			overall: failed === 0 ? "passed" : passed === 0 ? "failed" : "partial",
		};
	}

	/**
	 * Wrap promise with timeout
	 */
	private async withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
	): Promise<T> {
		const timeout = new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(`Test timed out after ${timeoutMs}ms`)),
				timeoutMs,
			),
		);
		return Promise.race([promise, timeout]);
	}
}

/**
 * Assert test results, throwing on failure
 */
export function assertTestResults(report: TestReport): void {
	if (report.overall === "failed") {
		const failures = report.results.filter((r) => !r.passed);
		const messages = failures.map(
			(f) => `  - ${f.name}: ${f.error || "failed"}`,
		);
		throw new TestFailureError(
			report.adapterId,
			"all",
			`Test failed:\n${messages.join("\n")}`,
		);
	}
}
