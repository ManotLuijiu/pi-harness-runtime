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

/**
 * Provider-specific patterns
 */
const PROVIDER_PATTERNS = {
	openai: [
		/(?:^|\s)OpenAI(?:$|\s)/i,
		/(?:^|\s)GPT(?:$|\s)/i,
		/openai.*(?:quota|limit|exhausted)/i,
		/gpt.*(?:quota|limit|exhausted)/i,
		/insufficient_quota/i,
		/context_length_exceeded/i,
		/openai.*rate.?limit/i,
		/429.*openai/i,
		/openai.*context.*(?:window|length)/i,
	],
	glm: [
		/(?:^|\s)GLM(?:$|\s)/i,
		/(?:^|\s)Zhipu(?:$|\s)/i,
		/glm.*(?:quota|limit|exhausted)/i,
		/zhipu.*(?:quota|limit|exhausted)/i,
		/glm.*context.*(?:window|length)/i,
		/glm.*rate.?limit/i,
	],
	anthropic: [
		/(?:^|\s)Claude(?:$|\s)/i,
		/(?:^|\s)Anthropic(?:$|\s)/i,
		/anthropic.*(?:quota|limit|exhausted)/i,
		/claude.*(?:quota|limit|exhausted)/i,
		/overloaded_error/i,
		/rate_limit_error/i,
	],
	openrouter: [
		/(?:^|\s)OpenRouter(?:$|\s)/i,
		/openrouter.*(?:quota|limit|exhausted)/i,
	],
};

const RESET_TIME_PATTERNS = [
	/reset(?:s)?\s+(?:at|in)\s+(\d{1,2}):(\d{2})/i,
	/(?:at|in)\s+(\d{1,2}):(\d{2})/i,
	/retry\s+after\s+(\d{1,2}):(\d{2})/i,
	/(\d{1,2}):(\d{2})\s*(?:am|pm)/i,
];

const PERCENTAGE_PATTERN = /(\d+)%/;

export class TUIUsageMonitor extends EventEmitter {
	private readonly quotaManager: QuotaManager;
	private readonly debug: boolean;
	private lastSignals: Map<string, TUIUsageSignal> = new Map();

	constructor(config: TUIUsageMonitorConfig) {
		super();
		this.quotaManager = config.quotaManager;
		this.debug = config.debug ?? false;
	}

	/**
	 * Process a TUI message and extract quota signals
	 */
	processMessage(message: string): TUIUsageSignal | null {
		// Try to identify provider
		const provider = this.detectProvider(message);
		if (!provider) {
			return null;
		}

		// Parse the signal
		const signal = this.parseSignal(message, provider);
		if (!signal) {
			return null;
		}

		// Store last signal
		this.lastSignals.set(provider, signal);

		// Record to QuotaManager
		this.recordToQuotaManager(signal);

		// Emit event
		this.emit("signal", signal);

		// Debug log
		if (this.debug) {
			console.log(`[TUIUsageMonitor] Detected ${provider}:`, signal);
		}

		return signal;
	}

	/**
	 * Detect which provider the message is about
	 */
	detectProvider(
		message: string,
	): "openai" | "glm" | "anthropic" | "openrouter" | null {
		for (const [provider, patterns] of Object.entries(PROVIDER_PATTERNS)) {
			for (const pattern of patterns) {
				if (pattern.test(message)) {
					return provider as "openai" | "glm" | "anthropic" | "openrouter";
				}
			}
		}
		return null;
	}

	/**
	 * Get the last signal for a provider
	 */
	getLastSignal(
		provider: "openai" | "glm" | "anthropic" | "openrouter",
	): TUIUsageSignal | null {
		return this.lastSignals.get(provider) ?? null;
	}

	/**
	 * Get all last signals
	 */
	getAllLastSignals(): Map<string, TUIUsageSignal> {
		return new Map(this.lastSignals);
	}

	/**
	 * Clear stored signals
	 */
	clear(): void {
		this.lastSignals.clear();
	}

	/**
	 * Parse the quota signal from message
	 */
	private parseSignal(
		message: string,
		provider: "openai" | "glm" | "anthropic" | "openrouter",
	): TUIUsageSignal | null {
		// Determine limit type
		const limitType = this.detectLimitType(message);

		// Parse reset time
		const resetsAt = this.parseResetTime(message);

		// Parse percentage if available
		const pctMatch = message.match(PERCENTAGE_PATTERN);
		const usedPct = pctMatch ? parseInt(pctMatch[1], 10) : undefined;

		// Determine if exhausted
		const exhausted =
			usedPct !== undefined
				? usedPct >= 100
				: this.containsExhaustedKeywords(message);

		if (!exhausted && !resetsAt) {
			// Not a quota signal
			return null;
		}

		return {
			provider,
			timestamp: new Date().toISOString(),
			usedPct,
			remainingPct: usedPct !== undefined ? 100 - usedPct : 0,
			exhausted,
			resetsAt,
			limitType,
			originalMessage: message,
		};
	}

	/**
	 * Detect the type of limit that was hit
	 */
	private detectLimitType(
		message: string,
	): "tokens" | "context_window" | "rate_limit" | "unknown" {
		const lowerMsg = message.toLowerCase();

		// Context window
		if (
			lowerMsg.includes("context") &&
			(lowerMsg.includes("window") ||
				lowerMsg.includes("length") ||
				lowerMsg.includes("full") ||
				lowerMsg.includes("exceeded"))
		) {
			return "context_window";
		}

		// Rate limit
		if (
			lowerMsg.includes("rate") ||
			lowerMsg.includes("429") ||
			lowerMsg.includes("too many requests")
		) {
			return "rate_limit";
		}

		// Tokens/quota exhausted
		if (
			lowerMsg.includes("quota") ||
			lowerMsg.includes("exhausted") ||
			lowerMsg.includes("ran out") ||
			lowerMsg.includes("limit")
		) {
			return "tokens";
		}

		return "unknown";
	}

	/**
	 * Check if message contains exhausted keywords
	 */
	private containsExhaustedKeywords(message: string): boolean {
		const keywords = [
			"exhausted",
			"quota",
			"limit",
			"rate limit",
			"429",
			"exceeded",
			"ran out",
		];
		const lowerMsg = message.toLowerCase();
		return keywords.some((kw) => lowerMsg.includes(kw));
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
				const matchIndex = message.indexOf(match[0]);
				const afterMatch = message.slice(matchIndex, matchIndex + 20);
				const isPM = /pm/i.test(afterMatch);
				const isAM = /am/i.test(afterMatch);

				if (isPM && hour < 12) hour += 12;
				if (isAM && hour === 12) hour = 0;

				// Convert to ISO string
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
	 * Record signal to QuotaManager
	 */
	private recordToQuotaManager(signal: TUIUsageSignal): void {
		// Map limit type to window type
		let windowType: "5h" | "daily" | "weekly" | "monthly" = "5h";

		if (signal.limitType === "context_window") {
			// Context window is usually daily or 5h depending on provider
			windowType = "daily";
		}

		// Record to QuotaManager
		this.quotaManager.recordSignal({
			provider: signal.provider,
			source: "tui_message",
			windowType,
			usedPct: signal.usedPct,
			exhausted: signal.exhausted,
			resetsAt: signal.resetsAt,
		});
	}
}

/**
 * Create a TUI usage monitor and automatically hook into pi
 */
export function createTUIUsageMonitor(
	quotaManager: QuotaManager,
	pi: {
		on: (event: string, handler: (event: { message: string }) => void) => void;
	},
	config?: { debug?: boolean },
): TUIUsageMonitor {
	const monitor = new TUIUsageMonitor({
		quotaManager,
		debug: config?.debug,
	});

	// Hook into pi events
	pi.on("error", (event: { message: string }) => {
		monitor.processMessage(event.message);
	});

	pi.on("message", (event: { message: string }) => {
		monitor.processMessage(event.message);
	});

	return monitor;
}
