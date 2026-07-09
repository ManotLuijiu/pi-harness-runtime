/**
 * Provider Adapter SDK
 *
 * A comprehensive SDK for building, testing, and registering provider adapters.
 */

// ─── Builder ────────────────────────────────────────────────────────────────

export { AdapterBuilder, BuiltAdapter } from "./builder.js";

// ─── Registry ────────────────────────────────────────────────────────────────

export { AdapterRegistry, type RegistryConfig } from "./registry.js";

// ─── Tester ─────────────────────────────────────────────────────────────────

export {
	AdapterTester,
	assertTestResults,
} from "./tester.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
	// SDK Types
	AdapterVersion,
	AdapterResult,
	ErrorAnalysis,
	QuotaSignal,
	RateLimitConfig,
	// Builder Types
	AdapterBuilderConfig,
	InvokeFunction,
	ErrorParserFunction,
	HealthCheckFunction,
	HealthCheckResult,
	// Registry Types
	AdapterInfo,
	AdapterLifecycle,
	AdapterState,
	CompatibilityResult,
	// Tester Types
	TestConfig,
	TestResult,
	TestReport,
	MockResponse,
	// Events
	RegistryEvents,
	// Re-exports from @pi/types
	ProviderCapability,
	ProviderRequest,
	ProviderResponse,
} from "./types.js";

// ─── Errors ─────────────────────────────────────────────────────────────────

export {
	AdapterError,
	AdapterNotFoundError,
	AdapterAlreadyRegisteredError,
	AdapterInvocationError,
	ModelNotSupportedError,
	AdapterStateError,
	CompatibilityError,
	TestFailureError,
	BuilderValidationError,
	LifecycleError,
} from "./errors.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * SDK version
 */
export { SDK_VERSION, SDK_VERSION as ADAPTER_SDK_VERSION } from "./types.js";
