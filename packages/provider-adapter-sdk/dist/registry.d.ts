/**
 * Provider Adapter SDK - Registry
 *
 * Registry for managing provider adapters with lifecycle hooks.
 */
/// <reference types="node" />
import { EventEmitter } from "node:events";
import type { AdapterInfo, AdapterLifecycle, AdapterResult, AdapterState, ErrorAnalysis, HealthCheckResult, ProviderCapability, ProviderRequest } from "./types.js";
import type { BuiltAdapter } from "./builder.js";
/**
 * Registry configuration
 */
export interface RegistryConfig {
    /** Enable automatic health checks */
    autoHealthCheck?: boolean;
    /** Health check interval in ms (default: 60000) */
    healthCheckInterval?: number;
    /** Timeout for health checks in ms (default: 5000) */
    healthCheckTimeout?: number;
    /** Enable lifecycle hooks */
    enableLifecycle?: boolean;
}
/**
 * Adapter registry with lifecycle management
 */
export declare class AdapterRegistry extends EventEmitter {
    private readonly adapters;
    private readonly config;
    constructor(config?: RegistryConfig);
    /**
     * Register an adapter
     */
    register(adapter: BuiltAdapter | {
        name: string;
        provider?: string;
        complete: (prompt: string, options?: Record<string, unknown>) => Promise<{
            content: string;
        }>;
    }, lifecycle?: AdapterLifecycle): Promise<AdapterInfo>;
    /**
     * Unregister an adapter
     */
    unregister(id: string): Promise<void>;
    /**
     * Get an adapter by ID
     */
    getAdapter(id: string): BuiltAdapter | undefined;
    /**
     * Get adapter by ID (alias)
     */
    get(id: string): BuiltAdapter | undefined;
    /**
     * Check if adapter exists
     */
    has(id: string): boolean;
    /**
     * List all adapters (alias)
     */
    listAll(): AdapterInfo[];
    /**
     * Get adapter info
     */
    getAdapterInfo(id: string): AdapterInfo | undefined;
    /**
     * List all adapters
     */
    listAdapters(): AdapterInfo[];
    /**
     * List adapters by capability
     */
    listByCapability(capability: ProviderCapability): AdapterInfo[];
    /**
     * Check if provider is supported
     */
    supportsCapability(capability: ProviderCapability): boolean;
    /**
     * Get adapters in a specific state
     */
    listByState(state: AdapterState): AdapterInfo[];
    /**
     * Invoke an adapter
     */
    invoke(id: string, request: ProviderRequest): Promise<AdapterResult>;
    /**
     * Parse error for an adapter
     */
    parseError(id: string, error: unknown): ErrorAnalysis;
    /**
     * Health check for a single adapter
     */
    healthCheck(id: string): Promise<HealthCheckResult>;
    /**
     * Health check all adapters
     */
    healthCheckAll(): Promise<Map<string, HealthCheckResult>>;
    /**
     * Start automatic health checks for an adapter
     */
    private startHealthCheck;
    /**
     * Stop automatic health checks for an adapter
     */
    stopHealthCheck(id: string): void;
    /**
     * Stop all health checks
     */
    stopAllHealthChecks(): void;
    /**
     * Check adapter compatibility with SDK
     */
    private checkCompatibility;
    /**
     * Create adapter info from entry
     */
    private createAdapterInfo;
    /**
     * Get registry statistics
     */
    getStats(): {
        total: number;
        byState: Record<AdapterState, number>;
        byCapability: Record<ProviderCapability, number>;
    };
}
/**
 * Create a new adapter registry
 */
export declare function createAdapterRegistry(config?: RegistryConfig): AdapterRegistry;
//# sourceMappingURL=registry.d.ts.map