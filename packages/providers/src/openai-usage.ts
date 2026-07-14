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

/**
 * OpenAI quota message patterns from TUI
 * These patterns match the messages pi displays when OpenAI hits limits
 */
const OPENAI_QUOTA_PATTERNS = [
	// Context window full
	{
		pattern: /OpenAI|GPT|context.*(?:window|length).*(?:full|exceeded|limit)/i,
		limitType: "context_window" as const,
	},
	// Tokens exhausted
	{
		pattern: /openai.*(?:quota|limit|exhausted|tokens?.*(?:ran out|exceeded))/i,
		limitType: "tokens" as const,
	},
	// Rate limit
	{
		pattern: /openai.*rate.?limit|429/i,
		limitType: "rate_limit" as const,
	},
	// Reset time patterns
	{
		pattern: /openai.*reset.*(?:at|in).*(\d{1,2}):(\d{2})/i,
		limitType: "unknown" as const,
	},
	// Error codes
	{
		pattern: /insufficient_quota|context_length_exceeded/i,
		limitType: "tokens" as const,
	},
];

const RESET_TIME_PATTERNS = [
	/reset(?:s)?\s+(?:at|in)\s+(\d{1,2}):(\d{2})/i,
	/(?:at|in)\s+(\d{1,2}):(\d{2})/i,
	/retry\s+after\s+(\d{1,2}):(\d{2})/i,
	/(\d{1,2}):(\d{2})\s*(?:am|pm)/i,
];

export class OpenAIUsageProvider extends EventEmitter {
	private lastUsageData: OpenAIUsageData | null = null;
	private onQuotaSignal?: (data: OpenAIUsageData) => void;

	constructor(config: OpenAIUsageConfig = {}) {
		super();
		this.onQuotaSignal = config.onQuotaSignal;
	}

	/**
	 * Check if auto-fetch is possible via TUI
	 * OpenAI reports quota via TUI, so this is always true when hooked
	 */
	supportsAutoFetch(): boolean {
		return true; // TUI integration is always available
	}

	/**
	 * Process a TUI message and extract OpenAI quota data
	 * Call this when receiving error/status messages from pi
	 */
	processTUIMessage(message: string): OpenAIUsageData | null {
		// Check if this is an OpenAI quota message
		for (const { pattern, limitType } of OPENAI_QUOTA_PATTERNS) {
			if (pattern.test(message)) {
				const usageData = this.parseOpenAIQuotaMessage(message, limitType);

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
				let hour = parseInt(match[1], 10);
				const minute = parseInt(match[2], 10);

				// Handle AM/PM
				const isPM = /pm/i.test(
					message.slice(match.index ?? 0, (match.index ?? 0) + 10),
				);
				const isAM = /am/i.test(
					message.slice(match.index ?? 0, (match.index ?? 0) + 10),
				);

				if (isPM && hour < 12) hour += 12;
				if (isAM && hour === 12) hour = 0;

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
	 * Parse the OpenAI quota message
	 */
	private parseOpenAIQuotaMessage(
		message: string,
		limitType: OpenAIUsageData["limitType"],
	): OpenAIUsageData {
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
			provider: "openai",
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
	getLastUsage(): OpenAIUsageData | null {
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
	async getUsage(): Promise<OpenAIUsageData> {
		if (!this.lastUsageData) {
			return {
				provider: "openai",
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
