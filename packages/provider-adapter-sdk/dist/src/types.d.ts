/**
 * Provider Adapter SDK - Types
 *
 * Core types for building provider adapters.
 */
import type { ProviderCapability, ProviderRequest, ProviderResponse } from "../../types/src/runtime-types.js";
/**
 * SDK version for compatibility checks
 */
export declare const SDK_VERSION = "1.0.0";
/**
 * Rate limit configuration for providers
 */
export interface RateLimitConfig {
    requestsPerMinute?: number;
    tokensPerMinute?: number;
    tokensPerDay?: number;
    concurrentRequests?: number;
}
/**
 * Adapter version information
 */
export interface AdapterVersion {
    sdk: string;
    minRuntime?: string;
    capabilities: ProviderCapability[];
}
/**
 * Quota signal extracted from error responses
 */
export interface QuotaSignal {
    exhausted: boolean;
    resetsAt?: string;
    retryAfterMs?: number;
    usedPercentage?: number;
    remainingTokens?: number;
}
/**
 * Error analysis result from adapter
 */
export interface ErrorAnalysis {
    quotaExceeded: boolean;
    rateLimited: boolean;
    timeout: boolean;
    serverError: boolean;
    clientError: boolean;
    quotaSignal?: QuotaSignal;
    message?: string;
    code?: string;
}
/**
 * Adapter invocation result with quota signals
 */
export interface AdapterResult {
    response: ProviderResponse;
    quotaSignal?: QuotaSignal;
    retryable: boolean;
    latencyMs?: number;
}
/**
 * Configuration for creating an adapter via Builder
 */
export interface AdapterBuilderConfig {
    id: string;
    name: string;
    models?: string[];
    capabilities?: ProviderCapability[];
    rateLimits?: RateLimitConfig;
    defaultModel?: string;
    maxTokens?: Record<string, number>;
}
/**
 * Invoke function signature for custom adapters
 */
export type InvokeFunction = (request: ProviderRequest) => Promise<ProviderResponse>;
/**
 * Error parser function signature
 */
export type ErrorParserFunction = (error: unknown) => ErrorAnalysis;
/**
 * Health check function signature
 */
export type HealthCheckFunction = () => Promise<HealthCheckResult>;
/**
 * Health check result
 */
export interface HealthCheckResult {
    healthy: boolean;
    latencyMs?: number;
    message?: string;
    timestamp: string;
}
/**
 * Lifecycle hooks for adapter management
 */
export interface AdapterLifecycle {
    onInit?: () => Promise<void>;
    onHealthCheck?: HealthCheckFunction;
    onTeardown?: () => Promise<void>;
}
/**
 * Adapter metadata for registry listing
 */
export interface AdapterInfo {
    id: string;
    name: string;
    version?: AdapterVersion;
    capabilities: ProviderCapability[];
    models: string[];
    registeredAt: string;
    state: AdapterState;
    lastHealthCheck?: HealthCheckResult;
}
/**
 * Adapter state in registry
 */
export type AdapterState = "registered" | "initializing" | "ready" | "error" | "unavailable";
/**
 * Test result from AdapterTester
 */
export interface TestResult {
    name: string;
    passed: boolean;
    duration: number;
    message?: string;
    error?: string;
    details?: Record<string, unknown>;
}
/**
 * Full test report from AdapterTester
 */
export interface TestReport {
    adapterId: string;
    timestamp: string;
    results: TestResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        duration: number;
    };
    overall: "passed" | "failed" | "partial";
}
/**
 * Test configuration
 */
export interface TestConfig {
    testInvocation?: boolean;
    testQuotaDetection?: boolean;
    testErrorParsing?: boolean;
    testHealthCheck?: boolean;
    testRateLimiting?: boolean;
    mockResponses?: boolean;
    timeout?: number;
}
/**
 * Mock response for testing
 */
export interface MockResponse {
    request: ProviderRequest;
    response: ProviderResponse;
    delayMs?: number;
}
/**
 * Compatibility check result
 */
export interface CompatibilityResult {
    compatible: boolean;
    issues: string[];
    warnings: string[];
}
/**
 * Registry events
 */
export interface RegistryEvents {
    onAdapterRegistered: (adapter: AdapterInfo) => void;
    onAdapterUnregistered: (adapterId: string) => void;
    onAdapterStateChanged: (adapterId: string, state: AdapterState) => void;
    onHealthCheckFailed: (adapterId: string, result: HealthCheckResult) => void;
}
export type { ProviderCapability, ProviderRequest, ProviderResponse, } from "../../types/src/runtime-types.js";
//# sourceMappingURL=types.d.ts.map