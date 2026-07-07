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

/**
 * GLM quota message patterns from TUI
 * These patterns match the messages pi displays when GLM hits limits
 */
const GLM_QUOTA_PATTERNS = [
	// Context window full
	{
		pattern: /GLM.*context.*(?:window|length).*(?:full|exceeded|limit)/i,
		limitType: "context_window" as const,
	},
	{
		pattern: /tokens.*(?:exhausted|limit|ran out|remaining).*(\d+)h?\s*(\d+)m/i,
		limitType: "tokens" as const,
	},
	// Reset time patterns
	{
		pattern: /GLM.*reset.*(?:at|in).*(\d{1,2}):(\d{2})/i,
		limitType: "unknown" as const,
	},
	{
		pattern: /GLM.*(?:quota|limit|exhausted|rate.?limit)/i,
		limitType: "tokens" as const,
	},
	// OpenRouter GLM via OpenRouter
	{
		pattern: /ZhipuAI|GLM.*(?:exhausted|limit|quota)/i,
		limitType: "tokens" as const,
	},
];

const RESET_TIME_PATTERNS = [
	/reset(?:s)?\s+(?:at|in)\s+(\d{1,2}):(\d{2})/i,
	/(?:at|in)\s+(\d{1,2}):(\d{2})/i,
	/retry\s+after\s+(\d{1,2}):(\d{2})/i,
];

export class GLMUsageProvider extends EventEmitter {
	private lastUsageData: GLMUsageData | null = null;
	private onQuotaSignal?: (data: GLMUsageData) => void;

	constructor(config: GLMUsageConfig = {}) {
		super();
		this.onQuotaSignal = config.onQuotaSignal;
	}

	/**
	 * Check if auto-fetch is possible via TUI
	 * GLM reports quota via TUI, so this is always true when hooked
	 */
	supportsAutoFetch(): boolean {
		return true; // TUI integration is always available
	}

	/**
	 * Process a TUI message and extract GLM quota data
	 * Call this when receiving error/status messages from pi
	 */
	processTUIMessage(message: string): GLMUsageData | null {
		// Check if this is a GLM quota message
		for (const { pattern, limitType } of GLM_QUOTA_PATTERNS) {
			if (pattern.test(message)) {
				const usageData = this.parseGLMQuotaMessage(message, limitType);

				if (usageData) {
					this.lastUsageData = usageData;

					// Emit event
					this.emit("quota", usageData);

					// Call callback if set
					this.onQuotaSignal?.(usageData);

					return usageData;
				}
			}
		}

		return null;
	}

	/**
	 * Parse reset time from message
	 */
	private parseResetTime(message: string): string | undefined {
		for (const pattern of RESET_TIME_PATTERNS) {
			const match = message.match(pattern);
			if (match) {
				const hour = parseInt(match[1], 10);
				const minute = parseInt(match[2], 10);

				// Convert to ISO string for today or tomorrow
				const now = new Date();
				const resetTime = new Date(now);
				resetTime.setHours(hour, minute, 0, 0);

				// If time has passed today, assume tomorrow
				if (resetTime <= now) {
					resetTime.setDate(resetTime.getDate() + 1);
				}

				return resetTime.toISOString();
			}
		}

		return undefined;
	}

	/**
	 * Parse the GLM quota message
	 */
	private parseGLMQuotaMessage(
		message: string,
		limitType: GLMUsageData["limitType"],
	): GLMUsageData {
		const resetsAt =
			this.parseResetTime(message) ??
			new Date(Date.now() + 60 * 60 * 1000).toISOString();

		// Try to extract percentage if present
		let usedPct: number | undefined;
		const pctMatch = message.match(/(\d+)%/);
		if (pctMatch) {
			usedPct = parseInt(pctMatch[1], 10);
		}

		return {
			provider: "glm",
			timestamp: new Date().toISOString(),
			usedPct,
			remainingPct: usedPct !== undefined ? 100 - usedPct : 0,
			exhausted: true,
			resetsAt,
			limitType,
			originalMessage: message,
		};
	}

	/**
	 * Get the last captured usage data
	 */
	getLastUsage(): GLMUsageData | null {
		return this.lastUsageData;
	}

	/**
	 * Clear stored usage data
	 */
	clear(): void {
		this.lastUsageData = null;
	}

	/**
	 * For QuotaManager integration
	 * Returns current state (from last TUI message)
	 */
	async getUsage(): Promise<GLMUsageData> {
		if (!this.lastUsageData) {
			return {
				provider: "glm",
				timestamp: new Date().toISOString(),
				remainingPct: 100,
				exhausted: false,
				resetsAt: "",
				limitType: "unknown",
				originalMessage: "",
			};
		}
		return this.lastUsageData;
	}

	/**
	 * Get usage as percentage
	 */
	async getUsagePercent(): Promise<number> {
		const usage = await this.getUsage();
		return usage.usedPct ?? 100 - usage.remainingPct;
	}

	/**
	 * Check if quota is exhausted
	 */
	async isExhausted(): Promise<boolean> {
		const usage = await this.getUsage();
		return usage.exhausted;
	}
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
