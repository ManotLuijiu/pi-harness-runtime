/**
 * Quota Manager — RFC-0003
 *
 * Collects quota signals from API responses, provider status,
 * Playwright, and local estimates. Produces provider availability state.
 */
import type { QuotaSignal, QuotaState } from "../../types/src/runtime-types.js";
export interface QuotaSignalInput {
    provider: string;
    source: "api_response" | "provider_status" | "playwright" | "local_estimate" | "tui_message";
    windowType: "5h" | "daily" | "weekly" | "monthly";
    usedPct?: number;
    exhausted?: boolean;
    resetsAt?: string;
    retryAfterMs?: number;
}
export declare class QuotaManager {
    private signals;
    private readonly staleThresholdMs;
    constructor(staleThresholdMs?: number);
    /**
     * Record a quota signal
     */
    recordSignal(input: QuotaSignalInput): void;
    /**
     * Get the latest signal for a provider
     */
    getLatestSignal(provider: string, windowType?: "5h" | "daily" | "weekly" | "monthly"): QuotaSignal | null;
    /**
     * Get quota state for a provider
     */
    getProviderState(provider: string): QuotaState;
    /**
     * Get signals for a provider
     */
    getSignals(provider: string): QuotaSignal[];
    /**
     * Check if provider is available
     */
    isAvailable(provider: string): boolean;
    /**
     * Check if provider is exhausted
     */
    isExhausted(provider: string): boolean;
    /**
     * Get time until provider is available again
     */
    getWaitTime(provider: string): number | null;
    /**
     * Get best available provider from a list
     */
    selectBestProvider(providers: string[]): string | null;
    /**
     * Clear stale signals
     */
    clearStale(): void;
    /**
     * Generate quota report
     */
    generateReport(providers: string[]): string;
}
/**
 * Parse quota signal from MiniMax error
 */
export declare function parseMiniMaxError(error: unknown): QuotaSignal | null;
/**
 * Parse quota signal from OpenAI error
 */
export declare function parseOpenAIError(error: unknown): QuotaSignal | null;
//# sourceMappingURL=quota-manager.d.ts.map