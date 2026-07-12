/**
 * Provider Adapter SDK
 *
 * A comprehensive SDK for building, testing, and registering provider adapters.
 */
// ─── Builder ────────────────────────────────────────────────────────────────
export { AdapterBuilder, BuiltAdapter, createProviderBuilder, } from "./builder.js";
// ─── Registry ────────────────────────────────────────────────────────────────
export { AdapterRegistry, createAdapterRegistry, } from "./registry.js";
// ─── Tester ─────────────────────────────────────────────────────────────────
export { AdapterTester, assertTestResults, createAdapterTester, } from "./tester.js";
// ─── Errors ─────────────────────────────────────────────────────────────────
export { AdapterError, AdapterNotFoundError, AdapterAlreadyRegisteredError, AdapterInvocationError, ModelNotSupportedError, AdapterStateError, CompatibilityError, TestFailureError, BuilderValidationError, LifecycleError, } from "./errors.js";
// ─── Constants ───────────────────────────────────────────────────────────────
/**
 * SDK version
 */
export { SDK_VERSION, SDK_VERSION as ADAPTER_SDK_VERSION } from "./types.js";
//# sourceMappingURL=index.js.map