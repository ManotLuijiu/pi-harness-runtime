/**
 * Provider Adapter SDK
 *
 * A comprehensive SDK for building, testing, and registering provider adapters.
 */
export { AdapterBuilder, BuiltAdapter, createProviderBuilder, } from "./builder.js";
export { AdapterRegistry, createAdapterRegistry, type RegistryConfig, } from "./registry.js";
export { AdapterTester, assertTestResults, createAdapterTester, } from "./tester.js";
export type { AdapterVersion, AdapterResult, ErrorAnalysis, QuotaSignal, RateLimitConfig, AdapterBuilderConfig, InvokeFunction, ErrorParserFunction, HealthCheckFunction, HealthCheckResult, AdapterInfo, AdapterLifecycle, AdapterState, CompatibilityResult, TestConfig, TestResult, TestReport, MockResponse, RegistryEvents, ProviderCapability, ProviderRequest, ProviderResponse, } from "./types.js";
export { AdapterError, AdapterNotFoundError, AdapterAlreadyRegisteredError, AdapterInvocationError, ModelNotSupportedError, AdapterStateError, CompatibilityError, TestFailureError, BuilderValidationError, LifecycleError, } from "./errors.js";
/**
 * SDK version
 */
export { SDK_VERSION, SDK_VERSION as ADAPTER_SDK_VERSION } from "./types.js";
//# sourceMappingURL=index.d.ts.map