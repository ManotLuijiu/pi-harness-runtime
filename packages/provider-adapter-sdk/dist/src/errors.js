/**
 * Provider Adapter SDK - Errors
 *
 * Custom error classes for the adapter SDK.
 */
/**
 * Base error for adapter SDK
 */
export class AdapterError extends Error {
    code;
    details;
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "AdapterError";
    }
}
/**
 * Thrown when an adapter is not found in registry
 */
export class AdapterNotFoundError extends AdapterError {
    constructor(adapterId) {
        super(`Adapter '${adapterId}' not found in registry`, "ADAPTER_NOT_FOUND", {
            adapterId,
        });
        this.name = "AdapterNotFoundError";
    }
}
/**
 * Thrown when an adapter is already registered
 */
export class AdapterAlreadyRegisteredError extends AdapterError {
    constructor(adapterId) {
        super(`Adapter '${adapterId}' is already registered`, "ADAPTER_ALREADY_REGISTERED", { adapterId });
        this.name = "AdapterAlreadyRegisteredError";
    }
}
/**
 * Thrown when adapter invocation fails
 */
export class AdapterInvocationError extends AdapterError {
    adapterId;
    retryable;
    originalError;
    constructor(message, adapterId, retryable, originalError) {
        super(message, "ADAPTER_INVOCATION_ERROR", {
            adapterId,
            retryable,
        });
        this.adapterId = adapterId;
        this.retryable = retryable;
        this.originalError = originalError;
        this.name = "AdapterInvocationError";
    }
}
/**
 * Thrown when a model is not supported
 */
export class ModelNotSupportedError extends AdapterError {
    constructor(model, adapterId, supportedModels) {
        super(`Model '${model}' is not supported by adapter '${adapterId}'`, "MODEL_NOT_SUPPORTED", { model, adapterId, supportedModels });
        this.name = "ModelNotSupportedError";
    }
}
/**
 * Thrown when adapter is not in expected state
 */
export class AdapterStateError extends AdapterError {
    constructor(adapterId, expectedState, actualState) {
        super(`Adapter '${adapterId}' is in state '${actualState}', expected '${expectedState}'`, "ADAPTER_STATE_ERROR", { adapterId, expectedState, actualState });
        this.name = "AdapterStateError";
    }
}
/**
 * Thrown when compatibility check fails
 */
export class CompatibilityError extends AdapterError {
    constructor(adapterId, issues, sdkVersion, runtimeVersion) {
        super(`Adapter '${adapterId}' is not compatible: ${issues.join(", ")}`, "COMPATIBILITY_ERROR", { adapterId, issues, sdkVersion, runtimeVersion });
        this.name = "CompatibilityError";
    }
}
/**
 * Thrown when test fails
 */
export class TestFailureError extends AdapterError {
    constructor(adapterId, testName, message, error) {
        super(`Test '${testName}' failed for adapter '${adapterId}': ${message}`, "TEST_FAILURE", { adapterId, testName, originalError: error });
        this.name = "TestFailureError";
    }
}
/**
 * Thrown when builder validation fails
 */
export class BuilderValidationError extends AdapterError {
    constructor(message, field) {
        super(message, "BUILDER_VALIDATION_ERROR", { field });
        this.name = "BuilderValidationError";
    }
}
/**
 * Thrown when lifecycle hook fails
 */
export class LifecycleError extends AdapterError {
    constructor(hook, adapterId, originalError) {
        super(`Lifecycle hook '${hook}' failed for adapter '${adapterId}'`, "LIFECYCLE_ERROR", { hook, adapterId, originalError });
        this.name = "LifecycleError";
    }
}
//# sourceMappingURL=errors.js.map