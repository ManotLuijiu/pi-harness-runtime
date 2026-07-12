/**
 * Provider Adapter SDK - Errors
 *
 * Custom error classes for the adapter SDK.
 */
/**
 * Base error for adapter SDK
 */
export declare class AdapterError extends Error {
    readonly code: string;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, code: string, details?: Record<string, unknown> | undefined);
}
/**
 * Thrown when an adapter is not found in registry
 */
export declare class AdapterNotFoundError extends AdapterError {
    constructor(adapterId: string);
}
/**
 * Thrown when an adapter is already registered
 */
export declare class AdapterAlreadyRegisteredError extends AdapterError {
    constructor(adapterId: string);
}
/**
 * Thrown when adapter invocation fails
 */
export declare class AdapterInvocationError extends AdapterError {
    readonly adapterId: string;
    readonly retryable: boolean;
    readonly originalError?: unknown | undefined;
    constructor(message: string, adapterId: string, retryable: boolean, originalError?: unknown | undefined);
}
/**
 * Thrown when a model is not supported
 */
export declare class ModelNotSupportedError extends AdapterError {
    constructor(model: string, adapterId: string, supportedModels: string[]);
}
/**
 * Thrown when adapter is not in expected state
 */
export declare class AdapterStateError extends AdapterError {
    constructor(adapterId: string, expectedState: string, actualState: string);
}
/**
 * Thrown when compatibility check fails
 */
export declare class CompatibilityError extends AdapterError {
    constructor(adapterId: string, issues: string[], sdkVersion: string, runtimeVersion?: string);
}
/**
 * Thrown when test fails
 */
export declare class TestFailureError extends AdapterError {
    constructor(adapterId: string, testName: string, message: string, error?: unknown);
}
/**
 * Thrown when builder validation fails
 */
export declare class BuilderValidationError extends AdapterError {
    constructor(message: string, field: string);
}
/**
 * Thrown when lifecycle hook fails
 */
export declare class LifecycleError extends AdapterError {
    constructor(hook: string, adapterId: string, originalError: unknown);
}
//# sourceMappingURL=errors.d.ts.map