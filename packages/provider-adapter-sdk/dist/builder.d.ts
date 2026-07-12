/**
 * Provider Adapter SDK - Builder
 *
 * Fluent API for creating provider adapters.
 */
import type { AdapterResult, AdapterBuilderConfig, ErrorAnalysis, HealthCheckResult, InvokeFunction, ErrorParserFunction, HealthCheckFunction, RateLimitConfig, ProviderCapability, ProviderRequest, ProviderResponse } from "./types.js";
/**
 * Builder class for creating provider adapters
 */
export declare class AdapterBuilder {
    private _id;
    private _name;
    private _models;
    private _capabilities;
    private _rateLimits;
    private _defaultModel;
    private _maxTokens;
    private _invokeFn;
    private _errorParserFn;
    private _healthCheckFn;
    constructor(name?: string);
    /**
     * Set the adapter ID
     */
    id(id: string): AdapterBuilder;
    /**
     * Set the adapter name
     */
    name(name: string): AdapterBuilder;
    /**
     * Set supported models
     */
    models(...models: string[]): AdapterBuilder;
    /**
     * Set default model (if different from first model)
     */
    defaultModel(model: string): AdapterBuilder;
    /**
     * Set capabilities
     */
    capabilities(...capabilities: ProviderCapability[]): AdapterBuilder;
    /**
     * Set rate limits
     */
    rateLimits(limits: RateLimitConfig): AdapterBuilder;
    /**
     * Set token limits per model
     */
    maxTokens(model: string, tokens: number): AdapterBuilder;
    /**
     * Set the invoke function (required)
     */
    invoke(fn: InvokeFunction): AdapterBuilder;
    /**
     * Set the complete function (alias for invoke)
     */
    complete(fn: (prompt: string, options?: Record<string, unknown>) => Promise<ProviderResponse>): AdapterBuilder;
    /**
     * Set custom error parser
     */
    parseError(fn: ErrorParserFunction): AdapterBuilder;
    /**
     * Set health check function
     */
    healthCheck(fn: HealthCheckFunction): AdapterBuilder;
    /**
     * Validate and build the adapter
     */
    build(): BuiltAdapter;
}
/**
 * Configuration for BuiltAdapter
 */
interface BuiltAdapterConfig {
    id: string;
    name: string;
    models: string[];
    capabilities: ProviderCapability[];
    rateLimits: RateLimitConfig;
    defaultModel: string;
    maxTokens: Record<string, number>;
    invokeFn: InvokeFunction;
    errorParserFn: ErrorParserFunction;
    healthCheckFn?: HealthCheckFunction;
}
/**
 * Built adapter instance
 */
export declare class BuiltAdapter {
    readonly id: string;
    readonly name: string;
    private readonly _models;
    private readonly _capabilities;
    private readonly _rateLimits;
    private readonly _defaultModel;
    private readonly _maxTokens;
    private readonly _invokeFn;
    private readonly _errorParserFn;
    private readonly _healthCheckFn?;
    constructor(config: BuiltAdapterConfig);
    /**
     * Get supported models
     */
    getModels(): string[];
    /**
     * Get capabilities
     */
    getCapabilities(): ProviderCapability[];
    /**
     * Get rate limits
     */
    getRateLimits(): RateLimitConfig;
    /**
     * Check if model is supported
     */
    supportsModel(model: string): boolean;
    /**
     * Get default model
     */
    getDefaultModel(): string;
    /**
     * Get max tokens for a model
     */
    getMaxTokens(model?: string): number;
    /**
     * Invoke the adapter
     */
    invoke(request: ProviderRequest): Promise<AdapterResult>;
    /**
     * Parse an error
     */
    parseError(error: unknown): ErrorAnalysis;
    /**
     * Health check
     */
    healthCheck(): Promise<HealthCheckResult>;
    /**
     * Convert to adapter info for registry
     */
    toConfig(): AdapterBuilderConfig;
}
/**
 * Create a new provider builder
 */
export declare function createProviderBuilder(name: string): AdapterBuilder;
export {};
//# sourceMappingURL=builder.d.ts.map