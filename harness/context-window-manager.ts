/**
 * Context Window Manager — RFC-0010
 *
 * Manages context window usage across providers.
 * Tracks utilization and suggests strategies when approaching limits.
 */

import type {
	ContextWindowStats,
	ContextWindowConfig,
	ProviderMessage,
} from "../packages/types/src/runtime-types.ts";

export interface ContextWindowUpdate {
	provider: string;
	model: string;
	maxTokens: number;
	usedTokens: number;
}

export class ContextWindowManager {
	private stats: Map<string, ContextWindowStats> = new Map();
	private configs: Map<string, ContextWindowConfig> = new Map();

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

		switch (strategy) {
			case "truncate": {
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

			case "summarize":
				// In a real implementation, this would use a summarization LLM
				// For now, fall back to truncate
				return this.prepareMessages(messages, maxTokens, "truncate");

			case "split":
				// Split into multiple requests if possible
				// Return first portion
				return this.prepareMessages(messages, maxTokens, "truncate");

			default:
				return messages;
		}
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

		for (const [key, stats] of this.stats.entries()) {
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

		return lines.join("\n");
	}

	private renderBar(pct: number, width: number = 20): string {
		const filled = Math.round(pct * width);
		const empty = width - filled;
		return "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
	}
}
