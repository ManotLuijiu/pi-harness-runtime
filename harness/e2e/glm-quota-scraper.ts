/**
 * GLM/z.ai Quota Scraper — API Key Authentication
 *
 * Scrapes quota/usage data from z.ai API using API key authentication.
 * Unlike cookie-based scrapers (MiniMax, OpenAI), this uses Bearer token auth.
 *
 * Target: https://api.z.ai/api/monitor/usage/model-usage
 *
 * Response shape:
 * {
 *   "code": 200,
 *   "data": {
 *     "x_time": ["2026-08-10 00:00", ...],
 *     "modelCallCount": [0, 0, 42, ...],
 *     "tokensUsage": [0, 0, 1200785, ...],
 *     "totalUsage": {
 *       "totalModelCallCount": 190,
 *       "totalTokensUsage": 6170914
 *     },
 *     "modelSummaryList": [{"modelName": "GLM-5.2", "totalTokens": 6170914}],
 *     "granularity": "hourly"
 *   },
 *   "success": true
 * }
 *
 * Also fetches subscription info from: /biz/subscription/list
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface GLMQuotaData {
	provider: "glm";
	/** Total model calls in the period */
	totalCalls: number;
	/** Total tokens used in the period */
	totalTokens: number;
	/** Model name (e.g., "GLM-5.2") */
	modelName: string;
	/** Hourly timestamps */
	hourlyTimestamps: string[];
	/** Hourly call counts */
	hourlyCalls: number[];
	/** Hourly token usage */
	hourlyTokens: number[];
	/** Raw API response for diagnostics */
	apiEndpoint?: string;
	/** Timestamp of scrape */
	scrapedAt: string;
}

export interface GLMSubscriptionData {
	/** Product name (e.g., "GLM Coding Lite") */
	productName: string;
	/** Subscription status (e.g., "VALID") */
	status: string;
	/** Purchase date */
	purchaseTime: string;
	/** Valid period (e.g., "2026-08-28 15:25:25-2026-09-28 15:25:25") */
	valid: string;
	/** Current period number */
	currentPeriod: number;
	/** Next renewal time */
	nextRenewTime: string;
	/** Billing cycle (e.g., "monthly") */
	billingCycle: string;
	/** Renewal price */
	renewPrice: number;
}

export interface GLMScraperConfig {
	/** Path to API key file (default: ~/.pi-harness-runtime/keys/zai-api-key.txt) */
	apiKeyFile?: string;
	/** Direct API key (optional, takes precedence over file) */
	apiKey?: string;
	/** Suppress console output */
	quiet?: boolean;
}

const DEFAULT_API_KEY_DIR = join(homedir(), ".pi-harness-runtime", "keys");
const DEFAULT_API_KEY_FILE = join(DEFAULT_API_KEY_DIR, "zai-api-key.txt");

// Also check legacy location
const LEGACY_API_KEY_FILE = join(homedir(), ".config", "zai-api-key.txt");
const API_BASE_URL = "https://api.z.ai/api";
const USAGE_ENDPOINT = "/monitor/usage/model-usage";
const SUBSCRIPTION_ENDPOINT = "/biz/subscription/list";

/**
 * Load API key from file, checking multiple locations
 */
function loadApiKey(path: string): string | null {
	if (existsSync(path)) {
		try {
			const key = readFileSync(path, "utf-8").trim();
			if (key && key.length > 10) return key;
		} catch {
			// ignore
		}
	}
	// Fallback to legacy location
	if (existsSync(LEGACY_API_KEY_FILE)) {
		try {
			const key = readFileSync(LEGACY_API_KEY_FILE, "utf-8").trim();
			if (key && key.length > 10) return key;
		} catch {
			// ignore
		}
	}
	return null;
}

/**
 * Format remaining seconds into human-readable string
 */
function formatRemainsSeconds(seconds: number): string {
	if (seconds <= 0) return "soon";

	const days = Math.floor(seconds / 86400);
	const hr = Math.floor((seconds % 86400) / 3600);
	const min = Math.floor((seconds % 3600) / 60);

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hr > 0) parts.push(`${hr}h`);
	if (min > 0 && days === 0) parts.push(`${min}m`);

	return parts.join(" ") || "0m";
}

/**
 * GLM/z.ai Quota Scraper
 *
 * Uses API key authentication to fetch quota data from z.ai.
 */
export class GLMQuotaScraper {
	private config: {
		apiKeyFile: string;
		apiKey: string | null;
		quiet: boolean;
	};

	constructor(config: GLMScraperConfig = {}) {
		// Resolve API key: direct value > file > null
		const apiKey = config.apiKey ?? loadApiKey(config.apiKeyFile ?? DEFAULT_API_KEY_FILE);

		this.config = {
			apiKeyFile: config.apiKeyFile ?? DEFAULT_API_KEY_FILE,
			apiKey: apiKey ?? null,
			quiet: config.quiet ?? false,
		};
	}

	/**
	 * Set API key directly
	 */
	setApiKey(key: string): this {
		this.config.apiKey = key;
		return this;
	}

	/**
	 * Set API key file path
	 */
	setApiKeyFile(path: string): this {
		this.config.apiKeyFile = path;
		this.config.apiKey = loadApiKey(path) ?? null;
		return this;
	}

	/**
	 * Check if any API key source exists
	 */
	hasApiKey(): boolean {
		if (this.config.apiKey && this.config.apiKey.length > 10) {
			return true;
		}
		// Try loading from default location
		const key = loadApiKey(this.config.apiKeyFile);
		return key !== null && key.length > 10;
	}

	/**
	 * Get the current API key
	 */
	getApiKey(): string | null {
		return this.config.apiKey ?? loadApiKey(this.config.apiKeyFile);
	}

	/**
	 * Fetch usage data from z.ai API
	 */
	async fetchUsage(startDate?: Date, endDate?: Date): Promise<GLMQuotaData | null> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			if (!this.config.quiet) {
				console.error(
					`[DEBUG GLMQuotaScraper] No API key found. ` +
					`Set ZAI_API_KEY env var or drop key into ${DEFAULT_API_KEY_FILE}`,
				);
			}
			return null;
		}

		// Default to last 7 days
		const end = endDate ?? new Date();
		const start = startDate ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

		const startStr = start.toISOString().replace("T", " ").replace("Z", "");
		const endStr = end.toISOString().replace("T", " ").replace("Z", "");

		const url = `${API_BASE_URL}${USAGE_ENDPOINT}?startTime=${encodeURIComponent(startStr)}&endTime=${encodeURIComponent(endStr)}`;

		try {
			if (!this.config.quiet) {
				console.log(`[DEBUG GLMQuotaScraper] Fetching usage from ${startStr} to ${endStr}`);
			}

			const response = await fetch(url, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			});

			if (!response.ok) {
				if (!this.config.quiet) {
					console.error(
						`[DEBUG GLMQuotaScraper] API returned ${response.status}: ${response.statusText}`,
					);
				}
				return null;
			}

			const data = await response.json() as {
				code?: number;
				success?: boolean;
				data?: {
					x_time?: string[];
					modelCallCount?: number[];
					tokensUsage?: number[];
					totalUsage?: {
						totalModelCallCount?: number;
						totalTokensUsage?: number;
					};
					modelSummaryList?: Array<{
						modelName?: string;
						totalTokens?: number;
					}>;
				};
				msg?: string;
			};

			if (!data.success || !data.data) {
				if (!this.config.quiet) {
					console.error(`[DEBUG GLMQuotaScraper] API error: ${data.msg ?? "Unknown error"}`);
				}
				return null;
			}

			const d = data.data;
			const totalUsage = d.totalUsage ?? {};
			const modelSummary = d.modelSummaryList?.[0];

			const result: GLMQuotaData = {
				provider: "glm",
				totalCalls: totalUsage.totalModelCallCount ?? 0,
				totalTokens: totalUsage.totalTokensUsage ?? 0,
				modelName: modelSummary?.modelName ?? "Unknown",
				hourlyTimestamps: d.x_time ?? [],
				hourlyCalls: d.modelCallCount ?? [],
				hourlyTokens: d.tokensUsage ?? [],
				apiEndpoint: url,
				scrapedAt: new Date().toISOString(),
			};

			if (!this.config.quiet) {
				console.log(
					`[DEBUG GLMQuotaScraper] Total calls: ${result.totalCalls}, ` +
					`Total tokens: ${result.totalTokens.toLocaleString()}, ` +
					`Model: ${result.modelName}`,
				);
			}

			return result;
		} catch (error) {
			if (!this.config.quiet) {
				console.error(
					"[DEBUG GLMQuotaScraper] Fetch error:",
					error instanceof Error ? error.message : String(error),
				);
			}
			return null;
		}
	}

	/**
	 * Fetch subscription info from z.ai API
	 */
	async fetchSubscription(): Promise<GLMSubscriptionData | null> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			return null;
		}

		const url = `${API_BASE_URL}${SUBSCRIPTION_ENDPOINT}`;

		try {
			const response = await fetch(url, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			});

			if (!response.ok) {
				return null;
			}

			const data = await response.json() as {
				code?: number;
				success?: boolean;
				data?: Array<{
					productName?: string;
					status?: string;
					purchaseTime?: string;
					valid?: string;
					currentPeriod?: number;
					nextRenewTime?: string;
					billingCycle?: string;
					renewPrice?: number;
				}>;
			};

			if (!data.success || !data.data || data.data.length === 0) {
				return null;
			}

			const sub = data.data[0];
			return {
				productName: sub.productName ?? "Unknown",
				status: sub.status ?? "Unknown",
				purchaseTime: sub.purchaseTime ?? "",
				valid: sub.valid ?? "",
				currentPeriod: sub.currentPeriod ?? 0,
				nextRenewTime: sub.nextRenewTime ?? "",
				billingCycle: sub.billingCycle ?? "monthly",
				renewPrice: sub.renewPrice ?? 0,
			};
		} catch {
			return null;
		}
	}

	/**
	 * Convenience method: get both usage and subscription data
	 */
	async scrape(): Promise<{
		usage: GLMQuotaData | null;
		subscription: GLMSubscriptionData | null;
	}> {
		const [usage, subscription] = await Promise.all([
			this.fetchUsage(),
			this.fetchSubscription(),
		]);
		return { usage, subscription };
	}

	/**
	 * Get weekly usage percentage (calls vs quota)
	 * For GLM, this calculates based on typical weekly allocation
	 */
	async getWeeklyUsagePercentage(): Promise<number | null> {
		const usage = await this.fetchUsage();
		if (!usage || usage.totalTokens === 0) {
			return null;
		}

		// GLM Coding Lite typically has a weekly token quota
		// Based on the subscription (monthly), we estimate weekly allocation
		// Typical allocation: ~50M tokens/month = ~12.5M tokens/week
		const WEEKLY_TOKEN_QUOTA = 12_500_000;
		const pct = Math.min(100, (usage.totalTokens / WEEKLY_TOKEN_QUOTA) * 100);
		return Math.round(pct);
	}

	/**
	 * Get when the quota resets (typically weekly on Sunday midnight or monthly)
	 */
	getQuotaResetInfo(): { resetsAt: string; resetAfterSeconds: number } {
		// GLM quotas typically reset weekly (Sunday midnight UTC) or monthly
		const now = new Date();
		const nextSunday = new Date(now);
		nextSunday.setDate(now.getDate() + (7 - now.getDay()));
		nextSunday.setUTCHours(0, 0, 0, 0);

		const diffMs = nextSunday.getTime() - now.getTime();
		const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));

		return {
			resetsAt: formatRemainsSeconds(diffSeconds),
			resetAfterSeconds: diffSeconds,
		};
	}
}

/**
 * Parse reset time from GLM 429 error message.
 * Extracts the reset timestamp from messages like:
 * '{"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-08-25 01:47:16"}'
 */
export function parseGLMErrorResetTime(errorMessage: string): string | null {
	// Try to find the JSON object in the message
	const jsonMatch = errorMessage.match(/\{[^{}]*\}/);
	if (jsonMatch) {
		try {
			const json = JSON.parse(jsonMatch[0]);
			if (json.code === 1308 && json.message) {
				// Extract datetime from message
				const datetimeMatch = json.message.match(
					/reset at (\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})/i,
				);
				if (datetimeMatch) {
					const datetimeStr = datetimeMatch[1].replace(" ", "T");
					const date = new Date(datetimeStr);
					if (!isNaN(date.getTime())) {
						return date.toISOString();
					}
				}
			}
		} catch {
			// Not JSON, try plain text parsing
		}
	}

	// Fallback: try plain text parsing
	const plainMatch = errorMessage.match(
		/reset at (\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})/i,
	);
	if (plainMatch) {
		const datetimeStr = plainMatch[1].replace(" ", "T");
		const date = new Date(datetimeStr);
		if (!isNaN(date.getTime())) {
			return date.toISOString();
		}
	}

	return null;
}

/**
 * Integration helper for index.ts
 */
export class GLMQuotaManager {
	private scraper: GLMQuotaScraper;
	private lastQuota?: GLMQuotaData;
	private lastFetchTime = 0;
	private readonly cacheDurationMs: number;

	constructor(config: GLMScraperConfig & { cacheDurationMs?: number } = {}) {
		this.scraper = new GLMQuotaScraper(config);
		this.cacheDurationMs = config.cacheDurationMs ?? 15 * 60 * 1000; // 15 min default
	}

	/**
	 * Get current quota (uses cache)
	 */
	async getQuota(forceRefresh = false): Promise<GLMQuotaData | null> {
		const now = Date.now();

		if (
			!forceRefresh &&
			this.lastQuota &&
			now - this.lastFetchTime < this.cacheDurationMs
		) {
			return this.lastQuota;
		}

		this.lastQuota = await this.scraper.fetchUsage() ?? undefined;
		this.lastFetchTime = now;
		return this.lastQuota ?? null;
	}

	/**
	 * Check if quota is available
	 */
	isAvailable(): boolean {
		return this.scraper.hasApiKey();
	}
}
