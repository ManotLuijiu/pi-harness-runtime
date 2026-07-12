/**
 * Model Registry Implementation (RFC-0053)
 */
import type { ModelFilters, ModelInfo, ModelRegistry, ModelRegistryEvent, ModelStatus } from "./types.js";
type EventHandler = (event: ModelRegistryEvent) => void;
/**
 * In-memory model registry with event emission
 */
export declare class InMemoryModelRegistry implements ModelRegistry {
    private models;
    private aliasIndex;
    private eventHandlers;
    constructor(loadDefaults?: boolean);
    /**
     * Load default models
     */
    private loadDefaults;
    /**
     * Create a unique key for provider/model pair
     */
    private makeKey;
    /**
     * Register a model
     */
    register(model: ModelInfo): void;
    /**
     * Unregister a model
     */
    unregister(providerId: string, modelId: string): void;
    /**
     * Get a model by provider and ID
     */
    get(providerId: string, modelId: string): ModelInfo | undefined;
    /**
     * Get a model by alias
     */
    getByAlias(alias: string): ModelInfo | undefined;
    /**
     * List all models, optionally filtered by provider
     */
    list(providerId?: string): ModelInfo[];
    /**
     * List only active models
     */
    listActive(): ModelInfo[];
    /**
     * Find models matching filters
     */
    find(filters: ModelFilters): ModelInfo[];
    /**
     * Update model status
     */
    updateStatus(providerId: string, modelId: string, status: ModelStatus): void;
    /**
     * Subscribe to events
     */
    onEvent(handler: EventHandler): () => void;
    /**
     * Emit an event
     */
    private emit;
}
/**
 * Create a new model registry
 */
export declare function createModelRegistry(loadDefaults?: boolean): InMemoryModelRegistry;
export {};
//# sourceMappingURL=registry.d.ts.map