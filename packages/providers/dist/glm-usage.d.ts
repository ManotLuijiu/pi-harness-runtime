/**
 * GLM (Zhipu AI) Usage Fetcher — TUI Integration
 *
 * GLM reports quota exhaustion directly via TUI in pi.dev.
 * When tokens run out or context window is full, pi shows:
 * - Exact reset time
 * - Which limit was hit
 *
 * This module hooks into TUI messages to capture quota signals.
 */
import { EventEmitter } from "node:events";
export interface GLMUsageData {
    provider: "glm";
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
export interface GLMUsageConfig {
    /** Called when GLM quota signal is detected from TUI */
    onQuotaSignal?: (data: GLMUsageData) => void;
}
export declare class GLMUsageProvider extends EventEmitter {
    private lastUsageData;
    private onQuotaSignal?;
    constructor(config?: GLMUsageConfig);
    /**
     * Check if auto-fetch is possible via TUI
     * GLM reports quota via TUI, so this is always true when hooked
     */
    supportsAutoFetch(): boolean;
    /**
     * Process a TUI message and extract GLM quota data
     * Call this when receiving error/status messages from pi
     */
    processTUIMessage(message: string): GLMUsageData | null;
    /**
     * Parse reset time from message
     */
    private parseResetTime;
    /**
     * Parse the GLM quota message
     */
    private parseGLMQuotaMessage;
    /**
     * Get the last captured usage data
     */
    getLastUsage(): GLMUsageData | null;
    /**
     * Clear stored usage data
     */
    clear(): void;
    /**
     * For QuotaManager integration
     * Returns current state (from last TUI message)
     */
    getUsage(): Promise<GLMUsageData>;
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
 * Integration helper: Hook GLM usage provider into pi extension
 *
 * Usage:
 * ```typescript
 * const glmUsage = new GLMUsageProvider({
 *   onQuotaSignal: (data) => {
 *     quotaManager.recordSignal({
 *       provider: "glm",
 *       source: "tui_message",
 *       windowType: data.limitType === "context_window" ? "daily" : "5h",
 *       exhausted: data.exhausted,
 *       resetsAt: data.resetsAt,
 *     });
 *   }
 * });
 *
 * pi.on("error", (event) => {
 *   glmUsage.processTUIMessage(event.message);
 * });
 *
 * pi.on("message", (event) => {
 *   glmUsage.processTUIMessage(event.message);
 * });
 * ```
 */
//# sourceMappingURL=glm-usage.d.ts.map