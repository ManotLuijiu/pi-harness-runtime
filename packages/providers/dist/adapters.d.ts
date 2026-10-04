/**
 * Provider Adapter — RFC-0002
 *
 * Normalizes provider-specific behavior for:
 * - model invocation
 * - error detection
 * - quota detection
 * - reset time discovery
 * - retry policy
 * - model capability metadata
 */
import type { ProviderConfig, ProviderCapability, ProviderRequest, ProviderResponse } from "../../types/src/runtime-types.js";
export interface AdapterConfig {
    provider: ProviderConfig;
    quotaSignalExtractor?: (error: unknown) => QuotaSignal | null;
}
export interface QuotaSignal {
    exhausted: boolean;
    resetsAt?: string;
    retryAfterMs?: number;
}
export interface AdapterResult {
    response: ProviderResponse;
    quotaSignal?: QuotaSignal;
    retryable: boolean;
}
export interface ProviderAdapter {
    readonly id: string;
    readonly name: string;
    invoke(request: ProviderRequest): Promise<AdapterResult>;
    parseError(error: unknown): {
        quotaExceeded: boolean;
        rateLimited: boolean;
        timeout: boolean;
        serverError: boolean;
        clientError: boolean;
        quotaSignal?: QuotaSignal;
    };
    getCapabilities(): ProviderCapability[];
    supportsModel(model: string): boolean;
    getDefaultModel(): string;
    getMaxTokens(model?: string): number;
}
/**
 * Base adapter with common functionality
 */
export declare abstract class BaseProviderAdapter implements ProviderAdapter {
    protected config: ProviderConfig;
    abstract readonly id: string;
    abstract readonly name: string;
    constructor(config: ProviderConfig);
    abstract invoke(request: ProviderRequest): Promise<AdapterResult>;
    abstract parseError(error: unknown): {
        quotaExceeded: boolean;
        rateLimited: boolean;
        timeout: boolean;
        serverError: boolean;
        clientError: boolean;
        quotaSignal?: QuotaSignal;
    };
    getCapabilities(): ProviderCapability[];
    supportsModel(model: string): boolean;
    getDefaultModel(): string;
    getMaxTokens(model?: string): number;
    /**
     * Parse usage from response
     */
    protected parseUsage(response: unknown): ProviderResponse["usage"];
}
/**
 * MiniMax adapter
 */
export declare class MiniMaxAdapter extends BaseProviderAdapter {
    readonly id = "minimax";
    readonly name = "MiniMax";
    invoke(request: ProviderRequest): Promise<AdapterResult>;
    parseError(error: unknown): {
        quotaExceeded: boolean;
        rateLimited: boolean;
        timeout: boolean;
        serverError: boolean;
        clientError: boolean;
        quotaSignal?: QuotaSignal;
    };
}
/**
 * OpenAI adapter
 */
export declare class OpenAIAdapter extends BaseProviderAdapter {
    readonly id = "openai";
    readonly name = "OpenAI";
    invoke(request: ProviderRequest): Promise<AdapterResult>;
    parseError(error: unknown): {
        quotaExceeded: boolean;
        rateLimited: boolean;
        timeout: boolean;
        serverError: boolean;
        clientError: boolean;
        quotaSignal?: QuotaSignal;
    };
}
/**
 * Claude adapter — Anthropic's Claude models
 */
export declare class ClaudeAdapter extends BaseProviderAdapter {
    readonly id = "anthropic";
    readonly name = "Anthropic Claude";
    invoke(request: ProviderRequest): Promise<AdapterResult>;
    parseError(error: unknown): {
        quotaExceeded: boolean;
        rateLimited: boolean;
        timeout: boolean;
        serverError: boolean;
        clientError: boolean;
        quotaSignal?: QuotaSignal;
    };
    getDefaultModel(): string;
    getMaxTokens(model?: string): number;
}
/**
 * Adapter registry
 */
export declare class AdapterRegistry {
    private adapters;
    register(adapter: ProviderAdapter): void;
    get(id: string): ProviderAdapter | undefined;
    list(): ProviderAdapter[];
    /**
     * Create default registry with standard adapters
     */
    static createDefault(): AdapterRegistry;
}
//# sourceMappingURL=adapters.d.ts.map