/**
 * Context Window Manager — RFC-0010
 *
 * Manages context window usage across providers.
 * Tracks utilization and suggests strategies when approaching limits.
 *
 * Enhanced with:
 * - Compact thresholds (proactive at 85%, blocking at 97%)
 * - Circuit breaker for consecutive compact failures
 * - Buffer-aware token estimation
 */

import type {
	ContextWindowUpdate,
	ContextWindowStats,
	ContextWindowConfig,
	ProviderMessage,
	CompactableMessage,
} from "../packages/types/src/runtime-types.ts";
import {
	roughTokenCount,
	roughMessagesTokens,
} from "../packages/token-estimation/src/index.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Proactive compact triggers at this many tokens before limit */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

/** Warning threshold buffer */
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000;

/** Blocking threshold buffer */
export const BLOCKING_THRESHOLD_BUFFER_TOKENS = 20_000;

/** Maximum consecutive compact failures before circuit breaker */
export const MAX_CONSECUTIVE_COMPACT_FAILURES = 3;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CompactThresholds {
	/** Trigger proactive compact at this utilization (0.85) */
	autoCompactAt: number;
	/** Show warning at this utilization (0.80) */
	warningAt: number;
	/** Block API calls at this utilization (0.97) */
	blockingAt: number;
	/** Max compact retry attempts */
	maxRetries: number;
	/** Reserved tokens for output during compact */
	reservedOutputTokens: number;
}

export interface TokenEstimate {
	total: number;
	bufferRemaining: number;
	utilizationPct: number;
	atRisk: boolean;
	shouldCompact: boolean;
	shouldBlock: boolean;
}

// ─── Context Window Manager ─────────────────────────────────────────────────

export class ContextWindowManager {
	private stats: Map<string, ContextWindowStats> = new Map();
	private configs: Map<string, ContextWindowConfig> = new Map();
	private consecutiveFailures = 0;
	private lastCompactTimestamp = 0;
	private modelContextWindows: Map<string, number> = new Map();

	constructor(defaultConfigs?: Record<string, ContextWindowConfig>) {
		// Initialize with defaults
		const defaults: Record<string, ContextWindowConfig> = {
			minimax: {
				warningThreshold: 0.8,
				criticalThreshold: 0.95,
				strategy: "truncate",
			},
			anthropic: {
				warningThreshold: 0.85,
				criticalThreshold: 0.97,
				strategy: "truncate",
			},
			openai: {
				warningThreshold: 0.8,
				criticalThreshold: 0.95,
				strategy: "truncate",
			},
			...defaultConfigs,
		};

		for (const [provider, config] of Object.entries(defaults)) {
			this.configs.set(provider, config);
		}
	}

	// ─── Public API ───────────────────────────────────────────────────────────

	/**
	 * Update context window stats after a request
	 */
	updateStats(update: ContextWindowUpdate): ContextWindowStats {
		const { provider, model, maxTokens, usedTokens } = update;
		const stats: ContextWindowStats = {
			provider,
			model,
			maxTokens,
			usedTokens,
			availableTokens: maxTokens - usedTokens,
			utilizationPct: usedTokens / maxTokens,
		};
		this.stats.set(`${provider}:${model}`, stats);
		return stats;
	}

	/**
	 * Get stats for a provider/model
	 */
	getStats(provider: string, model: string): ContextWindowStats | null {
		return this.stats.get(`${provider}:${model}`) ?? null;
	}

	/**
	 * Get all stats
	 */
	getAllStats(): ContextWindowStats[] {
		return Array.from(this.stats.values());
	}

	/**
	 * Check utilization status
	 */
	getUtilizationStatus(
		provider: string,
		model: string,
	): "ok" | "warning" | "critical" | "unknown" {
		const stats = this.getStats(provider, model);
		if (!stats) return "unknown";

		const config = this.configs.get(provider);
		if (!config) return "ok";

		const pct = stats.utilizationPct;
		if (pct >= config.criticalThreshold) return "critical";
		if (pct >= config.warningThreshold) return "warning";
		return "ok";
	}

	/**
	 * Get compact thresholds for a provider
	 */
	getCompactThresholds(provider: string): CompactThresholds {
		const config = this.configs.get(provider);
		return {
			autoCompactAt: 0.85,
			warningAt: config?.warningThreshold ?? 0.8,
			blockingAt: config?.criticalThreshold ?? 0.97,
			maxRetries: MAX_CONSECUTIVE_COMPACT_FAILURES,
			reservedOutputTokens: 20_000,
		};
	}

	/**
	 * Get effective context window size (minus reserved output tokens)
	 */
	getEffectiveContextWindow(provider: string, model: string): number {
		const key = `${provider}:${model}`;
		const base = this.modelContextWindows.get(key) ?? 200_000;
		const thresholds = this.getCompactThresholds(provider);
		return base - thresholds.reservedOutputTokens;
	}

	/**
	 * Set the context window size for a model
	 */
	setContextWindow(provider: string, model: string, maxTokens: number): void {
		this.modelContextWindows.set(`${provider}:${model}`, maxTokens);
	}

	/**
	 * Estimate remaining capacity
	 */
	estimateRemainingRequests(
		provider: string,
		model: string,
		avgTokensPerRequest: number,
	): number | null {
		const stats = this.getStats(provider, model);
		if (!stats) return null;
		return Math.floor(stats.availableTokens / avgTokensPerRequest);
	}

	/**
	 * Estimate tokens with buffer awareness for compact decisions
	 */
	estimateTokensWithBuffer(opts: {
		messages: CompactableMessage[];
		tools?: Array<{
			name: string;
			description?: string;
			input_schema?: Record<string, unknown>;
		}>;
		systemPrompt?: string;
		provider: string;
		model: string;
	}): TokenEstimate {
		const { messages, tools, systemPrompt, provider, model } = opts;

		// Calculate message tokens
		const messageTokens = roughMessagesTokens(
			messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
		);

		// Calculate tool tokens
		const toolTokens = (tools ?? []).reduce(
			(sum, tool) =>
				sum +
				roughTokenCount(tool.name) +
				roughTokenCount(tool.description ?? "") +
				roughTokenCount(JSON.stringify(tool.input_schema ?? {})),
			0,
		);

		// Calculate system prompt tokens
		const systemTokens = systemPrompt ? roughTokenCount(systemPrompt) : 0;

		const total = messageTokens + toolTokens + systemTokens;
		const effectiveWindow = this.getEffectiveContextWindow(provider, model);
		const bufferRemaining = effectiveWindow - total;

		// Determine if we should compact or block
		const autoCompactTokens = effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS;
		const blockingTokens = effectiveWindow - BLOCKING_THRESHOLD_BUFFER_TOKENS;

		const shouldCompact = total >= autoCompactTokens;
		const shouldBlock = total >= blockingTokens;

		return {
			total,
			bufferRemaining,
			utilizationPct: total / effectiveWindow,
			atRisk: bufferRemaining < AUTOCOMPACT_BUFFER_TOKENS,
			shouldCompact,
			shouldBlock,
		};
	}

	/**
	 * Check if we should trigger proactive compact
	 */
	shouldProactiveCompact(estimate: TokenEstimate): boolean {
		return estimate.shouldCompact && !this.shouldCircuitBreak();
	}

	/**
	 * Check if we should block (must compact before API call)
	 */
	shouldBlockApiCall(estimate: TokenEstimate): boolean {
		return estimate.shouldBlock;
	}

	/**
	 * Record a compact failure (for circuit breaker)
	 */
	recordCompactFailure(): number {
		this.consecutiveFailures++;
		return this.consecutiveFailures;
	}

	/**
	 * Record a compact success (reset circuit breaker)
	 */
	recordCompactSuccess(): void {
		this.consecutiveFailures = 0;
		this.lastCompactTimestamp = Date.now();
	}

	/**
	 * Check if circuit breaker should activate
	 */
	shouldCircuitBreak(): boolean {
		return this.consecutiveFailures >= MAX_CONSECUTIVE_COMPACT_FAILURES;
	}

	/**
	 * Get consecutive failure count
	 */
	getConsecutiveFailures(): number {
		return this.consecutiveFailures;
	}

	/**
	 * Reset circuit breaker
	 */
	resetCircuitBreaker(): void {
		this.consecutiveFailures = 0;
	}

	/**
	 * Get time since last compact (ms)
	 */
	getTimeSinceLastCompact(): number {
		return Date.now() - this.lastCompactTimestamp;
	}

	/**
	 * Prepare messages for a request (truncation/summarization strategy)
	 */
	prepareMessages(
		messages: ProviderMessage[],
		maxTokens: number,
		strategy: "truncate" | "summarize" | "split" = "truncate",
	): ProviderMessage[] {
		const estimateTokens = (text: string) => Math.ceil(text.length / 4);
		let totalTokens = messages.reduce(
			(sum, m) => sum + estimateTokens(m.content),
			0,
		);

		if (totalTokens <= maxTokens) {
			return messages;
		}

		if (strategy === "truncate") {
			// Remove oldest messages first
			const truncated = [...messages];
			while (totalTokens > maxTokens && truncated.length > 1) {
				const removed = truncated.shift();
				if (removed) {
					totalTokens -= estimateTokens(removed.content);
				}
			}
			return truncated;
		}

		// summarize and split both fall back to truncate for now
		// In a real implementation, split would return multiple message batches
		return this.prepareMessages(messages, maxTokens, "truncate");
	}

	/**
	 * Set config for a provider
	 */
	setConfig(provider: string, config: ContextWindowConfig): void {
		this.configs.set(provider, config);
	}

	/**
	 * Get config for a provider
	 */
	getConfig(provider: string): ContextWindowConfig | undefined {
		return this.configs.get(provider);
	}

	/**
	 * Generate utilization report
	 */
	generateReport(): string {
		const lines = ["Context Window Utilization Report", "=".repeat(40), ""];

		for (const [, stats] of this.stats.entries()) {
			const config = this.configs.get(stats.provider);
			const bar = this.renderBar(stats.utilizationPct);
			const status = this.getUtilizationStatus(stats.provider, stats.model);

			lines.push(`${stats.provider}/${stats.model}`);
			lines.push(`  ${bar} ${(stats.utilizationPct * 100).toFixed(1)}%`);
			lines.push(
				`  Used: ${stats.usedTokens.toLocaleString()} / ${stats.maxTokens.toLocaleString()} tokens`,
			);
			lines.push(
				`  Available: ${stats.availableTokens.toLocaleString()} tokens`,
			);
			lines.push(`  Status: ${status.toUpperCase()}`);
			if (config) {
				lines.push(
					`  Thresholds: warning=${(config.warningThreshold * 100).toFixed(0)}%, critical=${(config.criticalThreshold * 100).toFixed(0)}%`,
				);
			}
			lines.push("");
		}

		// Add circuit breaker status
		lines.push("Circuit Breaker Status", "-".repeat(20));
		lines.push(`Consecutive failures: ${this.consecutiveFailures}`);
		lines.push(`Circuit broken: ${this.shouldCircuitBreak() ? "YES ⚠️" : "No"}`);

		return lines.join("\n");
	}

	private renderBar(pct: number, width: number = 20): string {
		const filled = Math.round(pct * width);
		const empty = width - filled;
		return "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
	}
}

// ─── Microcompact Helpers ───────────────────────────────────────────────────

/**
 * Microcompact: prune old tool results based on time gap.
 * Returns the number of tokens freed.
 */
export function microcompactToolResults(
	messages: CompactableMessage[],
	options: {
		maxAgeMs?: number;
		keepRecent?: number;
	} = {},
): number {
	const maxAgeMs = options.maxAgeMs ?? 30 * 60 * 1000; // 30 minutes
	const keepRecent = options.keepRecent ?? 2;

	const now = Date.now();
	let freedTokens = 0;

	for (const msg of messages) {
		if (msg.role !== "assistant" || !msg.toolResults) continue;

		// Sort by timestamp, newest first
		const sorted = [...msg.toolResults].sort(
			(a, b) => b.timestamp - a.timestamp,
		);

		// Keep IDs of recent tool results
		const keepIds = new Set(sorted.slice(0, keepRecent).map((r) => r.id));

		// Prune old ones
		for (const tr of msg.toolResults) {
			if (!keepIds.has(tr.id) && now - tr.timestamp > maxAgeMs) {
				freedTokens += tr.tokens;
				// Truncate content but keep marker
				tr.content = "[Old tool result cleared]";
				tr.tokens = 0;
			}
		}
	}

	return freedTokens;
}

/**
 * Parse token gap from a prompt-too-long error message.
 * Returns the gap (excess tokens) or undefined if unparseable.
 */
export function parseTokenGapFromError(
	errorMessage: string,
): number | undefined {
	// Match patterns like: "137500 tokens > 135000 maximum"
	const match = errorMessage.match(
		/prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
	);
	if (match) {
		const actual = parseInt(match[1], 10);
		const limit = parseInt(match[2], 10);
		const gap = actual - limit;
		return gap > 0 ? gap : undefined;
	}
	return undefined;
}
