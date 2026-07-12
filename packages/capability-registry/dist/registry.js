/**
 * Capability Registry Implementation (RFC-0051)
 */
import { DEFAULT_CAPABILITIES } from "./defaults.js";
import { queryCapabilities } from "./query.js";
/**
 * In-memory capability registry with event emission
 */
export class InMemoryCapabilityRegistry {
    capabilities = new Map();
    capabilityIndex = new Map();
    eventHandlers = new Set();
    constructor(loadDefaults = true) {
        if (loadDefaults) {
            this.loadDefaults();
        }
    }
    /**
     * Load default capability profiles
     */
    loadDefaults() {
        for (const [providerId, models] of Object.entries(DEFAULT_CAPABILITIES)) {
            for (const [modelId, profiles] of Object.entries(models)) {
                this.register(providerId, modelId, profiles);
            }
        }
    }
    /**
     * Register capabilities for a model
     */
    register(providerId, modelId, capabilities) {
        const key = this.makeKey(providerId, modelId);
        // Store capabilities
        if (!this.capabilities.has(key)) {
            this.capabilities.set(key, new Map());
        }
        const modelCaps = this.capabilities.get(key);
        modelCaps.set(providerId, capabilities);
        // Also store in flat provider/model map
        if (!this.capabilities.has("by_model")) {
            this.capabilities.set("by_model", new Map());
        }
        this.capabilities.get("by_model").set(key, capabilities);
        // Update capability index
        for (const profile of capabilities) {
            if (!this.capabilityIndex.has(profile.capability)) {
                this.capabilityIndex.set(profile.capability, []);
            }
            this.capabilityIndex.get(profile.capability).push({
                providerId,
                modelId,
                profile,
            });
        }
        this.emit({
            type: "capability.registered",
            providerId,
            modelId,
            count: capabilities.length,
        });
    }
    /**
     * Unregister a model's capabilities
     */
    unregister(providerId, modelId) {
        const key = this.makeKey(providerId, modelId);
        const existing = this.capabilities.get("by_model")?.get(key);
        if (existing) {
            // Remove from capability index
            for (const profile of existing) {
                const index = this.capabilityIndex.get(profile.capability);
                if (index) {
                    const idx = index.findIndex((e) => e.providerId === providerId && e.modelId === modelId);
                    if (idx >= 0) {
                        index.splice(idx, 1);
                    }
                }
            }
            // Remove from storage
            this.capabilities.get("by_model")?.delete(key);
        }
        this.emit({
            type: "capability.unregistered",
            providerId,
            modelId,
        });
    }
    /**
     * Get capabilities for a specific model
     */
    getCapabilities(providerId, modelId) {
        const key = this.makeKey(providerId, modelId);
        return this.capabilities.get("by_model")?.get(key) ?? [];
    }
    /**
     * Query models by capability
     */
    query(capability, requirements) {
        const results = queryCapabilities((cap) => this.capabilityIndex.get(cap) ?? [], capability, requirements);
        this.emit({
            type: "capability.queried",
            capability,
            results: results.length,
        });
        return results;
    }
    /**
     * List all registered providers
     */
    listProviders() {
        const providers = new Set();
        for (const key of this.capabilities.get("by_model")?.keys() ?? []) {
            const [providerId] = this.parseKey(key);
            providers.add(providerId);
        }
        return Array.from(providers);
    }
    /**
     * List all models for a provider
     */
    listModels(providerId) {
        const models = [];
        for (const key of this.capabilities.get("by_model")?.keys() ?? []) {
            const [p, modelId] = this.parseKey(key);
            if (p === providerId) {
                models.push(modelId);
            }
        }
        return models;
    }
    /**
     * Subscribe to events
     */
    onEvent(handler) {
        this.eventHandlers.add(handler);
        return () => this.eventHandlers.delete(handler);
    }
    /**
     * Emit an event to all handlers
     */
    emit(event) {
        for (const handler of this.eventHandlers) {
            try {
                handler(event);
            }
            catch {
                // Ignore handler errors
            }
        }
    }
    /**
     * Create a unique key for provider/model pair
     */
    makeKey(providerId, modelId) {
        return `${providerId}::${modelId}`;
    }
    /**
     * Parse a key into provider/model
     */
    parseKey(key) {
        const [providerId, modelId] = key.split("::");
        return [providerId, modelId];
    }
}
/**
 * Create a new capability registry
 */
export function createCapabilityRegistry(loadDefaults = true) {
    return new InMemoryCapabilityRegistry(loadDefaults);
}
//# sourceMappingURL=registry.js.map