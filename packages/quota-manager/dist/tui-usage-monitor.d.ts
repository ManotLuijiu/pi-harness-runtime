/**
 * TUI Usage Monitor — Unified TUI Message Parser
 *
 * Hooks into pi's TUI messages to capture quota signals from all providers.
 * Handles OpenAI, GLM, and any other provider that reports via TUI.
 *
 * Usage:
 * ```typescript
 * const monitor = new TUIUsageMonitor(quotaManager);
 *
 * // Hook into pi
 * pi.on("error", (event) => monitor.processMessage(event.message));
 * pi.on("message", (event) => monitor.processMessage(event.message));
 * ```
 */
import { EventEmitter } from "node:events";
import type { QuotaManager } from "./quota-manager.js";
export interface TUIUsageSignal {
    provider: "openai" | "glm" | "anthropic" | "openrouter" | "unknown";
    timestamp: string;
    /** Usage percentage (0-100), if available */
    usedPct?: number;
    /** Remaining percentage (0-100) */
    remainingPct: number;
    /** If exhausted */
    exhausted: boolean;
    /** Reset time */
    resetsAt?: string;
    /** Which limit was hit */
    limitType: "tokens" | "context_window" | "rate_limit" | "unknown";
    /** Original message */
    originalMessage: string;
}
export interface TUIUsageMonitorConfig {
    /** QuotaManager instance to feed signals into */
    quotaManager: QuotaManager;
    /** Enable debug logging */
    debug?: boolean;
}
export declare class TUIUsageMonitor extends EventEmitter {
    private readonly quotaManager;
    private readonly debug;
    private lastSignals;
    constructor(config: TUIUsageMonitorConfig);
    /**
     * Process a TUI message and extract quota signals
     */
    processMessage(message: string): TUIUsageSignal | null;
    /**
     * Detect which provider the message is about
     */
    detectProvider(message: string): "openai" | "glm" | "anthropic" | "openrouter" | null;
    /**
     * Get the last signal for a provider
     */
    getLastSignal(provider: "openai" | "glm" | "anthropic" | "openrouter"): TUIUsageSignal | null;
    /**
     * Get all last signals
     */
    getAllLastSignals(): Map<string, TUIUsageSignal>;
    /**
     * Clear stored signals
     */
    clear(): void;
    /**
     * Parse the quota signal from message
     */
    private parseSignal;
    /**
     * Detect the type of limit that was hit
     */
    private detectLimitType;
    /**
     * Check if message contains exhausted keywords
     */
    private containsExhaustedKeywords;
    /**
     * Parse reset time from message
     */
    private parseResetTime;
    /**
     * Record signal to QuotaManager
     */
    private recordToQuotaManager;
}
/**
 * Create a TUI usage monitor and automatically hook into pi
 */
export declare function createTUIUsageMonitor(quotaManager: QuotaManager, pi: {
    on: (event: string, handler: (event: {
        message: string;
    }) => void) => void;
}, config?: {
    debug?: boolean;
}): TUIUsageMonitor;
//# sourceMappingURL=tui-usage-monitor.d.ts.map