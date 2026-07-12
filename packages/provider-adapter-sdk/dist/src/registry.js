/**
 * Provider Adapter SDK - Registry
 *
 * Registry for managing provider adapters with lifecycle hooks.
 */
import { EventEmitter } from "node:events";
import { SDK_VERSION } from "./types.js";
import { AdapterAlreadyRegisteredError, AdapterNotFoundError, AdapterStateError, CompatibilityError, LifecycleError, } from "./errors.js";
/**
 * Adapter registry with lifecycle management
 */
export class AdapterRegistry extends EventEmitter {
    adapters = new Map();
    config;
    constructor(config = {}) {
        super();
        this.config = {
            autoHealthCheck: config.autoHealthCheck ?? false,
            healthCheckInterval: config.healthCheckInterval ?? 60000,
            healthCheckTimeout: config.healthCheckTimeout ?? 5000,
            enableLifecycle: config.enableLifecycle ?? true,
        };
    }
    /**
     * Register an adapter
     */
    async register(adapter, lifecycle) {
        const { id } = adapter;
        if (this.adapters.has(id)) {
            throw new AdapterAlreadyRegisteredError(id);
        }
        // Check compatibility
        const compatibility = this.checkCompatibility(adapter);
        if (!compatibility.compatible) {
            throw new CompatibilityError(id, compatibility.issues, SDK_VERSION);
        }
        // Initialize lifecycle if enabled
        if (lifecycle?.onInit && this.config.enableLifecycle) {
            try {
                await lifecycle.onInit();
            }
            catch (error) {
                throw new LifecycleError("onInit", id, error);
            }
        }
        // Create version info
        const version = {
            sdk: SDK_VERSION,
            capabilities: adapter.getCapabilities(),
        };
        // Create registry entry
        const entry = {
            adapter,
            lifecycle,
            state: "ready",
            version,
            registeredAt: new Date().toISOString(),
        };
        this.adapters.set(id, entry);
        // Emit events
        const info = this.createAdapterInfo(entry);
        this.emit("adapterRegistered", info);
        // Start health check timer if enabled
        if (this.config.autoHealthCheck) {
            this.startHealthCheck(id);
        }
        return info;
    }
    /**
     * Unregister an adapter
     */
    async unregister(id) {
        const entry = this.adapters.get(id);
        if (!entry) {
            throw new AdapterNotFoundError(id);
        }
        // Stop health check timer
        if (entry.healthCheckTimer) {
            clearInterval(entry.healthCheckTimer);
        }
        // Run teardown lifecycle
        if (entry.lifecycle?.onTeardown && this.config.enableLifecycle) {
            try {
                await entry.lifecycle.onTeardown();
            }
            catch (error) {
                console.error(`[Registry] Teardown failed for ${id}:`, error);
            }
        }
        this.adapters.delete(id);
        this.emit("adapterUnregistered", id);
    }
    /**
     * Get an adapter by ID
     */
    getAdapter(id) {
        return this.adapters.get(id)?.adapter;
    }
    /**
     * Get adapter info
     */
    getAdapterInfo(id) {
        const entry = this.adapters.get(id);
        return entry ? this.createAdapterInfo(entry) : undefined;
    }
    /**
     * List all adapters
     */
    listAdapters() {
        return Array.from(this.adapters.values()).map((entry) => this.createAdapterInfo(entry));
    }
    /**
     * List adapters by capability
     */
    listByCapability(capability) {
        return this.listAdapters().filter((info) => info.capabilities.includes(capability));
    }
    /**
     * Check if provider is supported
     */
    supportsCapability(capability) {
        return this.listByCapability(capability).length > 0;
    }
    /**
     * Get adapters in a specific state
     */
    listByState(state) {
        return this.listAdapters().filter((info) => info.state === state);
    }
    /**
     * Invoke an adapter
     */
    async invoke(id, request) {
        const entry = this.adapters.get(id);
        if (!entry) {
            throw new AdapterNotFoundError(id);
        }
        if (entry.state !== "ready") {
            throw new AdapterStateError(id, "ready", entry.state);
        }
        return entry.adapter.invoke(request);
    }
    /**
     * Parse error for an adapter
     */
    parseError(id, error) {
        const entry = this.adapters.get(id);
        if (!entry) {
            throw new AdapterNotFoundError(id);
        }
        return entry.adapter.parseError(error);
    }
    /**
     * Health check for a single adapter
     */
    async healthCheck(id) {
        const entry = this.adapters.get(id);
        if (!entry) {
            throw new AdapterNotFoundError(id);
        }
        const timeout = this.config.healthCheckTimeout;
        const healthCheckPromise = entry.adapter.healthCheck();
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({
            healthy: false,
            message: "Health check timed out",
            timestamp: new Date().toISOString(),
        }), timeout));
        const result = await Promise.race([healthCheckPromise, timeoutPromise]);
        // Update entry
        entry.lastHealthCheck = result;
        // Update state based on health
        const wasHealthy = entry.state === "ready";
        if (!result.healthy && wasHealthy) {
            entry.state = "error";
            this.emit("adapterStateChanged", id, "error");
            this.emit("healthCheckFailed", id, result);
        }
        else if (result.healthy && entry.state === "error") {
            entry.state = "ready";
            this.emit("adapterStateChanged", id, "ready");
        }
        return result;
    }
    /**
     * Health check all adapters
     */
    async healthCheckAll() {
        const results = new Map();
        await Promise.allSettled(Array.from(this.adapters.keys()).map(async (id) => {
            const result = await this.healthCheck(id);
            results.set(id, result);
        }));
        return results;
    }
    /**
     * Start automatic health checks for an adapter
     */
    startHealthCheck(id) {
        const entry = this.adapters.get(id);
        if (!entry)
            return;
        // Clear existing timer
        if (entry.healthCheckTimer) {
            clearInterval(entry.healthCheckTimer);
        }
        // Start new timer
        entry.healthCheckTimer = setInterval(async () => {
            await this.healthCheck(id);
        }, this.config.healthCheckInterval);
    }
    /**
     * Stop automatic health checks for an adapter
     */
    stopHealthCheck(id) {
        const entry = this.adapters.get(id);
        if (entry?.healthCheckTimer) {
            clearInterval(entry.healthCheckTimer);
            entry.healthCheckTimer = undefined;
        }
    }
    /**
     * Stop all health checks
     */
    stopAllHealthChecks() {
        for (const [id] of this.adapters) {
            this.stopHealthCheck(id);
        }
    }
    /**
     * Check adapter compatibility with SDK
     */
    checkCompatibility(adapter) {
        const issues = [];
        const warnings = [];
        // Check if adapter has required methods
        if (typeof adapter.invoke !== "function") {
            issues.push("Adapter missing invoke method");
        }
        if (typeof adapter.parseError !== "function") {
            issues.push("Adapter missing parseError method");
        }
        // Check models
        if (adapter.getModels().length === 0) {
            warnings.push("Adapter has no models specified");
        }
        return {
            compatible: issues.length === 0,
            issues,
            warnings,
        };
    }
    /**
     * Create adapter info from entry
     */
    createAdapterInfo(entry) {
        return {
            id: entry.adapter.id,
            name: entry.adapter.name,
            version: entry.version,
            capabilities: entry.adapter.getCapabilities(),
            models: entry.adapter.getModels(),
            registeredAt: entry.registeredAt,
            state: entry.state,
            lastHealthCheck: entry.lastHealthCheck,
        };
    }
    /**
     * Get registry statistics
     */
    getStats() {
        const byState = {
            registered: 0,
            initializing: 0,
            ready: 0,
            error: 0,
            unavailable: 0,
        };
        const byCapability = {
            code: 0,
            review: 0,
            plan: 0,
            test: 0,
            e2e: 0,
            refactor: 0,
            analysis: 0,
            debug: 0,
        };
        for (const entry of this.adapters.values()) {
            byState[entry.state]++;
            for (const cap of entry.adapter.getCapabilities()) {
                byCapability[cap]++;
            }
        }
        return {
            total: this.adapters.size,
            byState,
            byCapability,
        };
    }
}
//# sourceMappingURL=registry.js.map