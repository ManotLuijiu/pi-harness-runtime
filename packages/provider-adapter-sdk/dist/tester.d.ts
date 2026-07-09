/**
 * Provider Adapter SDK - Tester
 *
 * Testing utilities for provider adapters.
 */
import type { MockResponse, ProviderRequest, TestConfig, TestReport, TestResult } from "./types.js";
import type { BuiltAdapter } from "./builder.js";
/**
 * Tester utility for validating adapters
 */
export declare class AdapterTester {
    private readonly adapter;
    private readonly config;
    private mockResponses;
    private testStartTime;
    constructor(adapter: BuiltAdapter, config?: TestConfig);
    /**
     * Run all tests
     */
    runAllTests(): Promise<TestReport>;
    /**
     * Test model availability
     */
    testModelAvailability(model: string): Promise<TestResult>;
    /**
     * Test basic invocation
     */
    testBasicInvocation(request: ProviderRequest): Promise<TestResult>;
    /**
     * Test quota detection
     */
    testQuotaDetection(): Promise<TestResult>;
    /**
     * Test error parsing
     */
    testErrorParsing(): Promise<TestResult>;
    /**
     * Test health check
     */
    testHealthCheck(): Promise<TestResult>;
    /**
     * Test rate limiting behavior
     */
    testRateLimiting(request: ProviderRequest): Promise<TestResult>;
    /**
     * Add mock responses for testing
     */
    addMockResponse(mock: MockResponse): void;
    /**
     * Clear mock responses
     */
    clearMockResponses(): void;
    /**
     * Generate mock responses based on adapter config
     */
    generateMockResponses(): void;
    /**
     * Create test report
     */
    private createReport;
    /**
     * Wrap promise with timeout
     */
    private withTimeout;
}
/**
 * Assert test results, throwing on failure
 */
export declare function assertTestResults(report: TestReport): void;
/**
 * Create a new adapter tester
 */
export declare function createAdapterTester(adapter: import("./builder.js").BuiltAdapter, config?: TestConfig): AdapterTester;
//# sourceMappingURL=tester.d.ts.map