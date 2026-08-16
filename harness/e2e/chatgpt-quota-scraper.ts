/**
 * ChatGPT/OpenAI OAuth Quota Scraper — Token-Based Auth
 *
 * Scrapes quota data from ChatGPT using OAuth tokens from ~/.codex/auth.json.
 * Handles automatic token refresh when access_token is expired.
 *
 * Target: https://chatgpt.com/backend-api/wham/usage
 *
 * Response shape:
 * {
 *   "rate_limit": {
 *     "primary_window": {
 *       "used_percent": 0,           // Weekly usage percentage (0-100)
 *       "limit_window_seconds": 604800,  // 7-day window
 *       "reset_after_seconds": 491924,   // Seconds until reset
 *       "reset_at": 1785649269          // Unix timestamp
 *     }
 *   },
 *   "credits": {
 *     "has_credits": false,
 *     "balance": "0"
 *   }
 * }
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ChatGPTQuotaData {
	provider: "openai" | "openai-codex";
	/** Weekly used percentage (0-100) */
	weeklyUsedPct: number;
	/** When the weekly window resets (e.g., "5d 16h") */
	weeklyResetsAt: string;
	/** Epoch ms when the weekly window resets */
	weeklyResetsAtEpoch?: number;
	/** Seconds until reset */
	resetAfterSeconds?: number;
	/** Credits balance (if available) */
	creditBalance?: string;
	/** Plan type (e.g., "plus", "pro") */
	planType?: string;
	/** Raw API response URL for diagnostics */
	apiEndpoint?: string;
	/** Timestamp of scrape */
	scrapedAt: string;
}

export interface ChatGPTAuthTokens {
	access_token: string;
	refresh_token: string;
	id_token: string;
	account_id: string;
	client_id: string;
}

export interface ChatGPTScraperConfig {
	/** Path to auth.json file (default: ~/.codex/auth.json) */
	authFile?: string;
	/** Save refreshed tokens to auth file */
	saveTokens?: boolean;
	/** Suppress console output */
	quiet?: boolean;
}

const DEFAULT_AUTH_FILE = join(homedir(), ".codex", "auth.json");
const TOKEN_REFRESH_URL = "https://auth.openai.com/oauth/token";
const USAGE_API = "https://chatgpt.com/backend-api/wham/usage";

interface AuthJsonShape {
	auth_mode?: string;
	tokens: {
		id_token?: string;
		access_token?: string;
		refresh_token?: string;
		account_id?: string;
	};
}

/**
 * Load and parse auth.json
 */
function loadAuthFile(path: string): AuthJsonShape | null {
	if (!existsSync(path)) {
		return null;
	}
	try {
		const content = readFileSync(path, "utf-8");
		return JSON.parse(content) as AuthJsonShape;
	} catch {
		return null;
	}
}

/**
 * Extract client_id from id_token payload (JWT)
 */
function extractClientId(idToken: string): string | null {
	try {
		const parts = idToken.split(".");
		if (parts.length < 2) return null;
		// Add padding if needed
		let payload = parts[1];
		const padding = "=".repeat((4 - (payload.length % 4)) % 4);
		payload += padding;
		const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
		const aud = decoded.aud;
		return Array.isArray(aud) ? aud[0] : aud;
	} catch {
		return null;
	}
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
 * ChatGPT OAuth Quota Scraper
 *
 * Uses OAuth tokens from ~/.codex/auth.json with automatic refresh.
 */
export class ChatGPTQuotaScraper {
	private config: {
		authFile: string;
		saveTokens: boolean;
		quiet: boolean;
	};
	private cachedTokens?: ChatGPTAuthTokens;

	constructor(config: ChatGPTScraperConfig = {}) {
		this.config = {
			authFile: config.authFile ?? DEFAULT_AUTH_FILE,
			saveTokens: config.saveTokens ?? true,
			quiet: config.quiet ?? false,
		};
	}

	/**
	 * Check if auth file exists
	 */
	hasAuthFile(): boolean {
		return existsSync(this.config.authFile);
	}

	/**
	 * Load tokens from auth file
	 */
	loadTokens(): ChatGPTAuthTokens | null {
		const auth = loadAuthFile(this.config.authFile);
		if (!auth || !auth.tokens) {
			return null;
		}

		const tokens = auth.tokens;
		const client_id = tokens.id_token ? extractClientId(tokens.id_token) : null;

		if (!tokens.access_token || !tokens.refresh_token || !client_id) {
			return null;
		}

		return {
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			id_token: tokens.id_token ?? "",
			account_id: tokens.account_id ?? "",
			client_id,
		};
	}

	/**
	 * Save tokens back to auth file
	 */
	private saveTokensToFile(tokens: Partial<ChatGPTAuthTokens>): boolean {
		if (!this.config.saveTokens) return true;

		try {
			const auth = loadAuthFile(this.config.authFile);
			if (!auth) return false;

			auth.tokens = {
				...auth.tokens,
				access_token: tokens.access_token ?? auth.tokens.access_token,
				refresh_token: tokens.refresh_token ?? auth.tokens.refresh_token,
				id_token: tokens.id_token ?? auth.tokens.id_token,
			};

			writeFileSync(this.config.authFile, JSON.stringify(auth, null, 2));
			return true;
		} catch (error) {
			if (!this.config.quiet) {
				console.error(
					"[DEBUG ChatGPTQuotaScraper] Failed to save tokens:",
					error instanceof Error ? error.message : String(error),
				);
			}
			return false;
		}
	}

	/**
	 * Refresh OAuth token
	 */
	async refreshToken(refreshToken: string, clientId: string): Promise<{
		access_token: string;
		refresh_token?: string;
		id_token?: string;
	} | null> {
		try {
			const response = await fetch(TOKEN_REFRESH_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					client_id: clientId,
				}),
			});

			if (!response.ok) {
				if (!this.config.quiet) {
					console.error(
						`[DEBUG ChatGPTQuotaScraper] Token refresh failed: ${response.status}`,
					);
				}
				return null;
			}

			const data = await response.json() as {
				access_token?: string;
				refresh_token?: string;
				id_token?: string;
			};

			return {
				access_token: data.access_token ?? "",
				refresh_token: data.refresh_token,
				id_token: data.id_token,
			};
		} catch (error) {
			if (!this.config.quiet) {
				console.error(
					"[DEBUG ChatGPTQuotaScraper] Token refresh error:",
					error instanceof Error ? error.message : String(error),
				);
			}
			return null;
		}
	}

	/**
	 * Get valid access token (auto-refreshes if needed)
	 */
	async getValidAccessToken(): Promise<ChatGPTAuthTokens | null> {
		// Check cache first
		if (this.cachedTokens?.access_token) {
			// Verify token is not expired by trying a quick API call
			const testResult = await this.testToken(this.cachedTokens);
			if (testResult === "valid") {
				return this.cachedTokens;
			}
			if (testResult === "refreshed" && this.cachedTokens) {
				return this.cachedTokens;
			}
		}

		// Load from file
		const tokens = this.loadTokens();
		if (!tokens) {
			if (!this.config.quiet) {
				console.error(
					`[DEBUG ChatGPTQuotaScraper] No auth tokens found in ${this.config.authFile}`,
				);
			}
			return null;
		}

		// Test current token
		const testResult = await this.testToken(tokens);
		if (testResult === "valid") {
			this.cachedTokens = tokens;
			return tokens;
		}

		// Token expired or invalid - refresh
		if (!this.config.quiet) {
			console.log("[DEBUG ChatGPTQuotaScraper] Access token expired, refreshing...");
		}

		const newTokens = await this.refreshToken(tokens.refresh_token, tokens.client_id);
		if (!newTokens || !newTokens.access_token) {
			if (!this.config.quiet) {
				console.error("[DEBUG ChatGPTQuotaScraper] Failed to refresh token");
			}
			return null;
		}

		// Save new tokens if successful
		this.saveTokensToFile(newTokens);

		// Return updated tokens
		this.cachedTokens = {
			...tokens,
			access_token: newTokens.access_token,
			refresh_token: newTokens.refresh_token ?? tokens.refresh_token,
			id_token: newTokens.id_token ?? tokens.id_token,
		};

		return this.cachedTokens;
	}

	/**
	 * Test if a token is valid
	 * Returns: "valid" | "expired" | "refreshed"
	 */
	private async testToken(tokens: ChatGPTAuthTokens): Promise<"valid" | "expired" | "refreshed"> {
		try {
			const response = await fetch(USAGE_API, {
				headers: {
					Authorization: `Bearer ${tokens.access_token}`,
					"ChatGPT-Account-Id": tokens.account_id,
					"User-Agent": "CodexBar/1.0",
					Accept: "application/json",
				},
			});

			if (response.ok) {
				return "valid";
			}

			if (response.status === 401) {
				const body = await response.json() as { error?: { code?: string } };
				if (body.error?.code === "token_expired") {
					return "expired";
				}
			}

			return "expired";
		} catch {
			return "expired";
		}
	}

	/**
	 * Scrape quota data using OAuth tokens
	 */
	async scrape(): Promise<ChatGPTQuotaData | null> {
		const tokens = await this.getValidAccessToken();
		if (!tokens) {
			return null;
		}

		try {
			const response = await fetch(USAGE_API, {
				headers: {
					Authorization: `Bearer ${tokens.access_token}`,
					"ChatGPT-Account-Id": tokens.account_id,
					"User-Agent": "CodexBar/1.0",
					Accept: "application/json",
				},
			});

			if (!response.ok) {
				if (!this.config.quiet) {
					console.error(
						`[DEBUG ChatGPTQuotaScraper] Usage API failed: ${response.status}`,
					);
				}
				return null;
			}

			const data = await response.json() as {
				rate_limit?: {
					primary_window?: {
						used_percent?: number;
						limit_window_seconds?: number;
						reset_after_seconds?: number;
						reset_at?: number;
					};
				};
				credits?: {
					has_credits?: boolean;
					balance?: string;
				};
				plan_type?: string;
			};

			const primaryWindow = data?.rate_limit?.primary_window;
			const weeklyUsedPct = primaryWindow?.used_percent ?? 0;
			const resetAfterSeconds = primaryWindow?.reset_after_seconds ?? 0;
			const resetAtEpoch = primaryWindow?.reset_at;

			if (!this.config.quiet) {
				console.log(
					`[DEBUG ChatGPTQuotaScraper] Weekly usage: ${weeklyUsedPct}%, resets in ${formatRemainsSeconds(resetAfterSeconds)}`,
				);
			}

			return {
				provider: "openai",
				weeklyUsedPct,
				weeklyResetsAt: formatRemainsSeconds(resetAfterSeconds),
				weeklyResetsAtEpoch: resetAtEpoch ? resetAtEpoch * 1000 : undefined,
				resetAfterSeconds,
				creditBalance: data.credits?.has_credits ? data.credits.balance : undefined,
				planType: data.plan_type,
				apiEndpoint: USAGE_API,
				scrapedAt: new Date().toISOString(),
			};
		} catch (error) {
			if (!this.config.quiet) {
				console.error(
					"[DEBUG ChatGPTQuotaScraper] Usage fetch error:",
					error instanceof Error ? error.message : String(error),
				);
			}
			return null;
		}
	}
}

/**
 * Integration helper for index.ts
 */
export class ChatGPTQuotaManager {
	private scraper: ChatGPTQuotaScraper;
	private lastQuota?: ChatGPTQuotaData;
	private lastFetchTime = 0;
	private readonly cacheDurationMs: number;

	constructor(config: ChatGPTScraperConfig & { cacheDurationMs?: number } = {}) {
		this.scraper = new ChatGPTQuotaScraper(config);
		this.cacheDurationMs = config.cacheDurationMs ?? 5 * 60 * 1000; // 5 min default
	}

	/**
	 * Get current quota (uses cache)
	 */
	async getQuota(forceRefresh = false): Promise<ChatGPTQuotaData | null> {
		const now = Date.now();

		if (
			!forceRefresh &&
			this.lastQuota &&
			now - this.lastFetchTime < this.cacheDurationMs
		) {
			return this.lastQuota;
		}

		this.lastQuota = await this.scraper.scrape() ?? undefined;
		this.lastFetchTime = now;
		return this.lastQuota ?? null;
	}

	/**
	 * Check if quota is available
	 */
	isAvailable(): boolean {
		return this.scraper.hasAuthFile();
	}
}
