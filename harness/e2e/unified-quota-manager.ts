/**
 * Unified Quota Manager — Handles all providers with appropriate auth
 *
 * Authentication strategies by provider:
 * | Provider   | Auth Method     | Status    |
 * |------------|----------------|-----------|
 * | MiniMax    | Browser cookies| ✅ Working|
 * | GLM/z.ai   | API Key        | ✅ Exists |
 * | ChatGPT    | OAuth tokens   | ✅ Exists |
 * | Codex      | OAuth tokens   | ✅ Exists |
 * | OpenAI     | API Key        | ✅ Exists |
 */

import {
	MiniMaxQuotaManager,
	type MiniMaxQuotaData,
} from "./minimax-quota-scraper.js";

import {
	GLMQuotaManager,
	GLMQuotaScraper,
	type GLMQuotaData,
} from "./glm-quota-scraper.js";

import {
	ChatGPTQuotaManager,
	ChatGPTQuotaScraper,
	type ChatGPTQuotaData,
} from "./chatgpt-quota-scraper.js";

import {
	OpenAIQuotaManager,
	OpenAIQuotaScraper,
	type OpenAIQuotaData,
} from "./openai-quota-scraper.js";

export type Provider = "minimax" | "glm" | "chatgpt" | "openai-codex" | "openai";

export interface QuotaData {
	provider: Provider;
	/** Usage percentage (0-100) */
	usagePercent: number;
	/** Human-readable reset time */
	resetsAt?: string;
	/** Epoch ms when quota resets */
	resetsAtEpoch?: number;
	/** Plan type */
	planType?: string;
	/** Total quota amount */
	totalQuota?: string;
	/** Used quota amount */
	usedQuota?: string;
	/** Remaining quota */
	remainingQuota?: string;
	/** Raw data */
	raw?: Record<string, unknown>;
	/** Timestamp */
	scrapedAt: string;
}

export interface UnifiedQuotaConfig {
	/** Provider to use (auto-detect if not specified) */
	provider?: Provider;
	/** Cookie file path (for browser-based providers) */
	cookieFile?: string;
	/** API key file path (for API-based providers) */
	apiKeyFile?: string;
	/** Direct API key value */
	apiKey?: string;
	/** Auth file path (for OAuth-based providers) */
	authFile?: string;
	/** Cache duration in ms (default: 5 min) */
	cacheDurationMs?: number;
	/** Suppress console output */
	quiet?: boolean;
}

interface QuotaManager {
	isAvailable(): boolean;
	getQuota(forceRefresh?: boolean): Promise<unknown>;
}

/**
 * Unified Quota Manager
 *
 * Provides a single interface to query quota data from all supported providers.
 * Automatically detects available providers based on credentials.
 */
export class UnifiedQuotaManager {
	private managers: Map<Provider, QuotaManager> = new Map();
	private activeProvider?: Provider;
	private cacheDurationMs: number;
	private quiet: boolean;

	constructor(config: UnifiedQuotaConfig = {}) {
		this.cacheDurationMs = config.cacheDurationMs ?? 5 * 60 * 1000;
		this.quiet = config.quiet ?? false;

		// Initialize managers based on config
		if (!config.provider || config.provider === "minimax") {
			const mmManager = new MiniMaxQuotaManager({
				cookieFile: config.cookieFile,
				cacheDurationMs: this.cacheDurationMs,
				quiet: this.quiet,
			});
			this.managers.set("minimax", mmManager);
		}

		if (!config.provider || config.provider === "glm") {
			const glmManager = new GLMQuotaManager({
				apiKey: config.apiKey,
				apiKeyFile: config.apiKeyFile,
				quiet: this.quiet,
			});
			this.managers.set("glm", glmManager);
		}

		if (!config.provider || config.provider === "chatgpt" || config.provider === "openai-codex") {
			const chatgptManager = new ChatGPTQuotaManager({
				authFile: config.authFile,
				quiet: this.quiet,
			});
			this.managers.set("chatgpt", chatgptManager);
			// openai-codex uses the same ChatGPT quota endpoint
			this.managers.set("openai-codex", chatgptManager);
		}

		if (!config.provider || config.provider === "openai") {
			const openaiManager = new OpenAIQuotaManager({
				cookieFile: config.cookieFile,
				quiet: this.quiet,
			});
			this.managers.set("openai", openaiManager);
		}

		// Set active provider
		if (config.provider) {
			this.activeProvider = config.provider;
		} else {
			// Auto-detect first available provider
			this.activeProvider = this.detectAvailableProvider();
		}
	}

	/**
	 * Detect the first available provider
	 */
	private detectAvailableProvider(): Provider | undefined {
		const priority: Provider[] = ["minimax", "glm", "chatgpt", "openai-codex", "openai"];

		for (const provider of priority) {
			const manager = this.managers.get(provider);
			if (manager && manager.isAvailable()) {
				if (!this.quiet) {
					console.log(`[UnifiedQuota] Auto-detected provider: ${provider}`);
				}
				return provider;
			}
		}

		return undefined;
	}

	/**
	 * Get all available providers
	 */
	getAvailableProviders(): Provider[] {
		const available: Provider[] = [];
		for (const [provider, manager] of this.managers) {
			if (manager.isAvailable()) {
				available.push(provider);
			}
		}
		return available;
	}

	/**
	 * Check if a provider is available
	 */
	isProviderAvailable(provider: Provider): boolean {
		const manager = this.managers.get(provider);
		return manager?.isAvailable() ?? false;
	}

	/**
	 * Set active provider
	 */
	setProvider(provider: Provider): boolean {
		const manager = this.managers.get(provider);
		if (manager && manager.isAvailable()) {
			this.activeProvider = provider;
			return true;
		}
		return false;
	}

	/**
	 * Get current provider
	 */
	getProvider(): Provider | undefined {
		return this.activeProvider;
	}

	/**
	 * Get quota data from active provider
	 */
	async getQuota(forceRefresh = false): Promise<QuotaData | null> {
		if (!this.activeProvider) {
			if (!this.quiet) {
				console.warn("[UnifiedQuota] No provider available");
			}
			return null;
		}

		const manager = this.managers.get(this.activeProvider);
		if (!manager) {
			return null;
		}

		try {
			const data = await manager.getQuota(forceRefresh);
			if (!data) return null;

			return this.normalizeData(this.activeProvider, data);
		} catch (error) {
			if (!this.quiet) {
				console.error(`[UnifiedQuota] Failed to fetch quota:`, error);
			}
			return null;
		}
	}

	/**
	 * Get quota from specific provider
	 */
	async getQuotaForProvider(
		provider: Provider,
		forceRefresh = false,
	): Promise<QuotaData | null> {
		const manager = this.managers.get(provider);
		if (!manager) {
			return null;
		}

		try {
			const data = await manager.getQuota(forceRefresh);
			if (!data) return null;

			return this.normalizeData(provider, data);
		} catch (error) {
			if (!this.quiet) {
				console.error(`[UnifiedQuota] Failed to fetch ${provider} quota:`, error);
			}
			return null;
		}
	}

	/**
	 * Normalize provider-specific data to unified format
	 */
	private normalizeData(
		provider: Provider,
		data: unknown,
	): QuotaData {
		const base: QuotaData = {
			provider,
			usagePercent: 0,
			scrapedAt: new Date().toISOString(),
		};

		switch (provider) {
			case "minimax": {
				const d = data as MiniMaxQuotaData;
				return {
					...base,
					usagePercent: d.h5UsedPct,
					resetsAt: d.h5ResetsAt,
					resetsAtEpoch: d.h5ResetsAtEpoch,
					remainingQuota: d.creditBalance,
					// @ts-expect-error - raw access for diagnostics
					raw: d,
				};
			}

			case "glm": {
				const d = data as GLMQuotaData;
				// GLM doesn't provide usage percentage or quota limit directly
				// Show actual usage - percentage is unknown without quota info
				return {
					...base,
					usagePercent: 0, // Unknown - no quota limit in API response
					planType: d.modelName,
					usedQuota: `${(d.totalTokens / 1_000_000).toFixed(1)}M tokens`,
					totalQuota: "unknown",
					// @ts-expect-error - raw access for diagnostics
					raw: d,
				};
			}

			case "chatgpt":
			case "openai-codex": {
				const d = data as ChatGPTQuotaData;
				return {
					...base,
					usagePercent: d.weeklyUsedPct,
					resetsAt: d.weeklyResetsAt,
					resetsAtEpoch: d.weeklyResetsAtEpoch,
					planType: d.planType,
					remainingQuota: d.creditBalance,
					// @ts-expect-error - raw access for diagnostics
					raw: d,
				};
			}

			case "openai": {
				const d = data as OpenAIQuotaData;
				return {
					...base,
					usagePercent: d.weeklyUsedPct,
					resetsAt: d.weeklyResetsAt,
					resetsAtEpoch: d.weeklyResetsAtEpoch,
					remainingQuota: d.creditBalance,
					// @ts-expect-error - raw access for diagnostics
					raw: d,
				};
			}

			default:
				return base;
		}
	}

	/**
	 * Get summary for status display
	 */
	async getSummary(): Promise<string> {
		const quota = await this.getQuota();
		if (!quota) {
			return `${this.activeProvider ?? "unknown"}: no data`;
		}

		const left = Math.max(0, 100 - quota.usagePercent);
		const reset = quota.resetsAt ? ` · resets ${quota.resetsAt}` : "";

		return `${this.activeProvider}: ${left.toFixed(0)}% left${reset}`;
	}
}

/**
 * Create unified quota manager from environment variables
 */
export function createUnifiedQuotaManagerFromEnv(): UnifiedQuotaManager | null {
	const provider = (process.env.QUOTA_PROVIDER ?? "auto") as Provider | "auto";

	return new UnifiedQuotaManager({
		provider: provider === "auto" ? undefined : provider,
		cookieFile: process.env.QUOTA_COOKIE_FILE,
		apiKeyFile: process.env.QUOTA_API_KEY_FILE,
		apiKey: process.env.QUOTA_API_KEY,
		authFile: process.env.QUOTA_AUTH_FILE,
		cacheDurationMs: parseInt(process.env.QUOTA_CACHE_MS ?? "300000", 10),
		quiet: process.env.QUOTA_QUIET === "true",
	});
}
