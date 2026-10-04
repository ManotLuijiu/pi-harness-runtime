/**
 * OpenAI Usage Parser — TUI Message Parsing
 *
 * OpenAI (GPT) reports quota exhaustion via TUI in pi.dev.
 * When tokens run out or context window is full, pi shows:
 * - Exact reset time
 * - Which limit was hit
 *
 * This module hooks into TUI messages to capture quota signals.
 * No API key needed - uses the same method as GLM.
 */
import { EventEmitter } from "node:events";
export interface OpenAIUsageData {
    provider: "openai";
    timestamp: string;
    /** Usage percentage (0-100), if available */
    usedPct?: number;
    /** Remaining percentage (0-100) */
    remainingPct: number;
    /** If exhausted */
    exhausted: boolean;
    /** Reset time */
    resetsAt: string;
    /** Which limit was hit */
    limitType: "tokens" | "context_window" | "rate_limit" | "unknown";
    /** Original message from TUI */
    originalMessage: string;
}
export interface OpenAIUsageConfig {
    /** Called when OpenAI quota signal is detected from TUI */
    onQuotaSignal?: (data: OpenAIUsageData) => void;
}
export declare class OpenAIUsageProvider extends EventEmitter {
    private lastUsageData;
    private onQuotaSignal?;
    constructor(config?: OpenAIUsageConfig);
    /**
     * Check if auto-fetch is possible via TUI
     * OpenAI reports quota via TUI, so this is always true when hooked
     */
    supportsAutoFetch(): boolean;
    /**
     * Process a TUI message and extract OpenAI quota data
     * Call this when receiving error/status messages from pi
     */
    processTUIMessage(message: string): OpenAIUsageData | null;
    /**
     * Parse reset time from message
     */
    private parseResetTime;
    /**
     * Parse the OpenAI quota message
     */
    private parseOpenAIQuotaMessage;
    /**
     * Get the last captured usage data
     */
    getLastUsage(): OpenAIUsageData | null;
    /**
     * Clear stored usage data
     */
    clear(): void;
    /**
     * For QuotaManager integration
     * Returns current state (from last TUI message)
     */
    getUsage(): Promise<OpenAIUsageData>;
    /**
     * Get usage as percentage
     */
    getUsagePercent(): Promise<number>;
    /**
     * Check if quota is exhausted
     */
    isExhausted(): Promise<boolean>;
}
/**
 * Integration helper: Hook OpenAI usage provider into pi extension
 *
 * Usage:
 * ```typescript
 * const openaiUsage = new OpenAIUsageProvider({
 *   onQuotaSignal: (data) => {
 *     quotaManager.recordSignal({
 *       provider: "openai",
 *       source: "tui_message",
 *       windowType: data.limitType === "context_window" ? "daily" : "5h",
 *       exhausted: data.exhausted,
 *       resetsAt: data.resetsAt,
 *     });
 *   }
 * });
 *
 * pi.on("error", (event) => {
 *   openaiUsage.processTUIMessage(event.message);
 * });
 *
 * pi.on("message", (event) => {
 *   openaiUsage.processTUIMessage(event.message);
 * });
 * ```
 */
//# sourceMappingURL=openai-usage.d.ts.map