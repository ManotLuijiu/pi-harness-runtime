/**
 * Model Registry Implementation (RFC-0053)
 */
import { DEFAULT_MODELS } from "./defaults.js";
import { findModels } from "./query.js";
/**
 * In-memory model registry with event emission
 */
export class InMemoryModelRegistry {
    models = new Map();
    aliasIndex = new Map();
    eventHandlers = new Set();
    constructor(loadDefaults = true) {
        if (loadDefaults) {
            this.loadDefaults();
        }
    }
    /**
     * Load default models
     */
    loadDefaults() {
        for (const model of DEFAULT_MODELS) {
            this.register(model);
        }
    }
    /**
     * Create a unique key for provider/model pair
     */
    makeKey(providerId, modelId) {
        return `${providerId}::${modelId}`;
    }
    /**
     * Register a model
     */
    register(model) {
        const key = this.makeKey(model.providerId, model.id);
        this.models.set(key, model);
        // Index by aliases
        for (const alias of model.aliases) {
            this.aliasIndex.set(alias.toLowerCase(), model);
        }
        this.emit({
            type: "model.registered",
            providerId: model.providerId,
            modelId: model.id,
        });
    }
    /**
     * Unregister a model
     */
    unregister(providerId, modelId) {
        const key = this.makeKey(providerId, modelId);
        const model = this.models.get(key);
        if (model) {
            // Remove from alias index
            for (const alias of model.aliases) {
                this.aliasIndex.delete(alias.toLowerCase());
            }
            this.models.delete(key);
        }
        this.emit({
            type: "model.unregistered",
            providerId,
            modelId,
        });
    }
    /**
     * Get a model by provider and ID
     */
    get(providerId, modelId) {
        const key = this.makeKey(providerId, modelId);
        return this.models.get(key);
    }
    /**
     * Get a model by alias
     */
    getByAlias(alias) {
        return this.aliasIndex.get(alias.toLowerCase());
    }
    /**
     * List all models, optionally filtered by provider
     */
    list(providerId) {
        const all = Array.from(this.models.values());
        if (providerId) {
            return all.filter((m) => m.providerId === providerId);
        }
        return all;
    }
    /**
     * List only active models
     */
    listActive() {
        return Array.from(this.models.values()).filter((m) => m.status === "active");
    }
    /**
     * Find models matching filters
     */
    find(filters) {
        const results = findModels(this.list(), filters);
        this.emit({
            type: "model.queried",
            filters,
            results: results.length,
        });
        return results;
    }
    /**
     * Update model status
     */
    updateStatus(providerId, modelId, status) {
        const key = this.makeKey(providerId, modelId);
        const model = this.models.get(key);
        if (model) {
            model.status = status;
            if (status === "deprecated") {
                model.deprecatedAt = new Date().toISOString();
            }
            this.emit({
                type: "model.status_changed",
                providerId,
                modelId,
                status,
            });
        }
    }
    /**
     * Subscribe to events
     */
    onEvent(handler) {
        this.eventHandlers.add(handler);
        return () => this.eventHandlers.delete(handler);
    }
    /**
     * Emit an event
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
}
/**
 * Create a new model registry
 */
export function createModelRegistry(loadDefaults = true) {
    return new InMemoryModelRegistry(loadDefaults);
}
//# sourceMappingURL=registry.js.map