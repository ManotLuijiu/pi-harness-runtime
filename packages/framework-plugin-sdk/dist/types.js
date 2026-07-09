/**
 * Framework Plugin SDK - Types
 *
 * Core types for the plugin system.
 */
// ─── SDK Version ────────────────────────────────────────────────────────────
/**
 * SDK version for compatibility checks
 */
export const SDK_VERSION = "1.0.0";
// ─── Error Types ────────────────────────────────────────────────────────────
/**
 * Plugin error
 */
export class PluginError extends Error {
    code;
    pluginId;
    constructor(message, code, pluginId) {
        super(message);
        this.code = code;
        this.pluginId = pluginId;
        this.name = "PluginError";
    }
}
/**
 * Error codes
 */
export const PluginErrorCode = {
    MANIFEST_NOT_FOUND: "MANIFEST_NOT_FOUND",
    MANIFEST_INVALID: "MANIFEST_INVALID",
    ENTRY_NOT_FOUND: "ENTRY_NOT_FOUND",
    LOAD_FAILED: "LOAD_FAILED",
    INIT_FAILED: "INIT_FAILED",
    ACTIVATE_FAILED: "ACTIVATE_FAILED",
    DEACTIVATE_FAILED: "DEACTIVATE_FAILED",
    PERMISSION_DENIED: "PERMISSION_DENIED",
    CAPABILITY_NOT_FOUND: "CAPABILITY_NOT_FOUND",
    DEPENDENCY_MISSING: "DEPENDENCY_MISSING",
    DEPENDENCY_CONFLICT: "DEPENDENCY_CONFLICT",
    INCOMPATIBLE_VERSION: "INCOMPATIBLE_VERSION",
    HOOK_FAILED: "HOOK_FAILED",
    SANDBOX_ERROR: "SANDBOX_ERROR",
    ALREADY_LOADED: "ALREADY_LOADED",
    NOT_LOADED: "NOT_LOADED",
    NOT_ACTIVE: "NOT_ACTIVE",
};
//# sourceMappingURL=types.js.map