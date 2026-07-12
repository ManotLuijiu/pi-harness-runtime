/**
 * Capability Registry Implementation (RFC-0051)
 */
import type { Capability, CapabilityProfile, CapabilityQuery, CapabilityRegistry, CapabilityRegistryEvent, ModelWithCapability } from "./types.js";
type EventHandler = (event: CapabilityRegistryEvent) => void;
/**
 * In-memory capability registry with event emission
 */
export declare class InMemoryCapabilityRegistry implements CapabilityRegistry {
    private capabilities;
    private capabilityIndex;
    private eventHandlers;
    constructor(loadDefaults?: boolean);
    /**
     * Load default capability profiles
     */
    private loadDefaults;
    /**
     * Register capabilities for a model
     */
    register(providerId: string, modelId: string, capabilities: CapabilityProfile[]): void;
    /**
     * Unregister a model's capabilities
     */
    unregister(providerId: string, modelId: string): void;
    /**
     * Get capabilities for a specific model
     */
    getCapabilities(providerId: string, modelId: string): CapabilityProfile[];
    /**
     * Query models by capability
     */
    query(capability: Capability, requirements?: CapabilityQuery): ModelWithCapability[];
    /**
     * List all registered providers
     */
    listProviders(): string[];
    /**
     * List all models for a provider
     */
    listModels(providerId: string): string[];
    /**
     * Subscribe to events
     */
    onEvent(handler: EventHandler): () => void;
    /**
     * Emit an event to all handlers
     */
    private emit;
    /**
     * Create a unique key for provider/model pair
     */
    private makeKey;
    /**
     * Parse a key into provider/model
     */
    private parseKey;
}
/**
 * Create a new capability registry
 */
export declare function createCapabilityRegistry(loadDefaults?: boolean): InMemoryCapabilityRegistry;
export {};
//# sourceMappingURL=registry.d.ts.map