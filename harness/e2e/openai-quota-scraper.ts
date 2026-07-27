/**
 * OpenAI Quota Scraper — RFC-0031+
 *
 * Scrapes quota data from ChatGPT Codex analytics page using Playwright.
 * Uses cookie-based authentication to access the usage API.
 *
 * Target: https://chatgpt.com/backend-api/wham/usage
 *
 * Response shape:
 * {
 *   "rate_limit": {
 *     "primary_window": {
 *       "used_percent": 7,           // Weekly usage percentage (0-100)
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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface OpenAIQuotaData {
	provider: "openai";
	/** Weekly used percentage (0-100) */
	weeklyUsedPct: number;
	/** When the weekly window resets (e.g., "5 days 16 hr") */
	weeklyResetsAt: string;
	/** Epoch ms when the weekly window resets — precise UTC timestamp */
	weeklyResetsAtEpoch?: number;
	/** Seconds until reset */
	resetAfterSeconds?: number;
	/** Credits balance (if available) */
	creditBalance?: string;
	/** Raw API response URL for diagnostics */
	apiEndpoint?: string;
	/** Timestamp of scrape */
	scrapedAt: string;
}

export interface OpenAIScraperConfig {
	/** Path to Netscape-format cookie file */
	cookieFile?: string;
	/** Headless mode (default: true) */
	headless?: boolean;
	/** Timeout in ms (default: 60000) */
	timeout?: number;
	/** Chrome executable path (optional) */
	chromePath?: string;
	/** Suppress console output — for background/auto-fetch use */
	quiet?: boolean;
}

const DEFAULT_COOKIE_FILE = join(homedir(), ".config", "openai-cookies.txt");
const USAGE_API = "https://chatgpt.com/backend-api/wham/usage";
const ANALYTICS_URL =
	"https://chatgpt.com/codex/cloud/settings/analytics#usage";

interface NetscapeCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	expires?: number;
}

/**
 * Load Netscape-format cookies from file
 */
function loadNetscapeCookies(path: string): NetscapeCookie[] {
	const cookies: NetscapeCookie[] = [];

	if (!existsSync(path)) {
		return cookies;
	}

	const lines = readFileSync(path, "utf-8").split("\n");
	for (const line of lines) {
		if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) {
			continue;
		}

		let httpOnly = false;
		let trimmed = line;
		if (trimmed.startsWith("#HttpOnly_")) {
			httpOnly = true;
			trimmed = trimmed.slice("#HttpOnly_".length);
		}

		const parts = trimmed.split("\t");
		if (parts.length < 7) continue;

		const [domain, _flag, cookiePath, secure, expires, name, value] = parts;
		cookies.push({
			name,
			value,
			domain,
			path: cookiePath || "/",
			secure: secure.toUpperCase() === "TRUE",
			httpOnly,
			expires: parseInt(expires, 10) || undefined,
		});
	}

	return cookies;
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
	if (days > 0) parts.push(`${days} days`);
	if (hr > 0) parts.push(`${hr} hr`);
	if (min > 0 && days === 0) parts.push(`${min} min`);

	return parts.join(" ") || "0 min";
}

/**
 * OpenAI Quota Scraper
 *
 * Uses Playwright to fetch quota data from ChatGPT Codex analytics.
 */
export class OpenAIQuotaScraper {
	private readonly config: Required<OpenAIScraperConfig>;

	constructor(config: OpenAIScraperConfig = {}) {
		this.config = {
			cookieFile: config.cookieFile ?? DEFAULT_COOKIE_FILE,
			headless: config.headless ?? true,
			timeout: config.timeout ?? 60000,
			chromePath: config.chromePath ?? "",
			quiet: config.quiet ?? false,
		};
	}

	/**
	 * Set cookie file path
	 */
	setCookieFile(path: string): this {
		this.config.cookieFile = path;
		return this;
	}

	/**
	 * Enable/disable quiet mode
	 */
	setQuiet(quiet: boolean): this {
		this.config.quiet = quiet;
		return this;
	}

	/**
	 * Check if any cookie source exists
	 */
	hasCookieFile(): boolean {
		return existsSync(this.config.cookieFile);
	}

	/**
	 * Scrape quota data using Playwright
	 */
	async scrape(): Promise<OpenAIQuotaData> {
		const { chromium } = await import("playwright");

		const cookies = loadNetscapeCookies(this.config.cookieFile);
		if (cookies.length === 0) {
			const dropHint = join(homedir(), ".pi-harness-runtime", "cookies");
			const msg =
				`No OpenAI cookies found.\n` +
				`Drop your chatgpt.com cookies (Netscape or EditThisCookie JSON) into:\n` +
				`  ${dropHint}\n` +
				`Then run: bun run packages/cookie-sanitizer/src/sync.ts`;
			if (!this.config.quiet) console.error("[OpenAIQuotaScraper] " + msg);
			throw new Error(msg);
		}

		// Launch browser
		if (!this.config.quiet) {
			console.log("[OpenAIQuotaScraper] Launching browser...");
		}

		const browser = await chromium.launch({
			executablePath: this.config.chromePath || undefined,
			headless: this.config.headless,
			args: ["--no-sandbox", "--disable-dev-shm-usage"],
		});

		const context = await browser.newContext({
			locale: "en-US",
			viewport: { width: 1440, height: 900 },
			userAgent:
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		});

		// Inject cookies
		await context.addCookies(
			cookies.map((c) => ({
				name: c.name,
				value: c.value,
				domain: c.domain,
				path: c.path,
				secure: c.secure,
				httpOnly: c.httpOnly,
				expires: c.expires,
			})),
		);

		const page = await context.newPage();

		// Capture API responses
		let usageData: any = null;

		page.on("response", async (response) => {
			const url = response.url();
			if (url.includes("/wham/usage")) {
				try {
					usageData = await response.json().catch(() => null);
				} catch {
					// Ignore parse errors
				}
			}
		});

		try {
			// Navigate to analytics page
			if (!this.config.quiet) {
				console.log("[OpenAIQuotaScraper] Navigating to analytics page...");
			}

			await page.goto(ANALYTICS_URL, {
				waitUntil: "domcontentloaded",
				timeout: this.config.timeout,
			});

			// Wait for JS to render
			await page.waitForTimeout(5000);

			// Wait for network to settle
			try {
				await page.waitForLoadState("networkidle", { timeout: 10000 });
			} catch {
				// Network idle might not be achievable
			}

			// Check if redirected to login
			const currentUrl = page.url();
			if (currentUrl.includes("login") || currentUrl.includes("auth")) {
				const msg =
					"OpenAI cookies are expired or insufficient. Please re-export cookies from chatgpt.com.";
				if (!this.config.quiet) console.error("[OpenAIQuotaScraper] " + msg);
				throw new Error(msg);
			}

			// Parse the usage data from the captured API response
			if (!usageData) {
				const msg = "Failed to capture usage data from API";
				if (!this.config.quiet) console.error("[OpenAIQuotaScraper] " + msg);
				throw new Error(msg);
			}

			// Extract weekly usage from primary_window
			const primaryWindow = usageData?.rate_limit?.primary_window;
			const weeklyUsedPct = primaryWindow?.used_percent ?? 0;
			const resetAfterSeconds = primaryWindow?.reset_after_seconds ?? 0;
			const resetAtEpoch = primaryWindow?.reset_at;
			const weeklyResetsAt = formatRemainsSeconds(resetAfterSeconds);

			// Extract credits if available
			const credits = usageData?.credits;
			const creditBalance = credits?.has_credits ? credits.balance : undefined;

			if (!this.config.quiet) {
				console.log(
					`[OpenAIQuotaScraper] Weekly usage: ${weeklyUsedPct}%, resets in ${weeklyResetsAt}`,
				);
			}

			return {
				provider: "openai",
				weeklyUsedPct,
				weeklyResetsAt,
				weeklyResetsAtEpoch: resetAtEpoch ? resetAtEpoch * 1000 : undefined,
				resetAfterSeconds,
				creditBalance,
				apiEndpoint: USAGE_API,
				scrapedAt: new Date().toISOString(),
			};
		} finally {
			await browser.close();
		}
	}

	/**
	 * Quick scrape using direct API fetch (faster, but may fail without browser context)
	 */
	async scrapeDirect(): Promise<OpenAIQuotaData | null> {
		const cookies = loadNetscapeCookies(this.config.cookieFile);
		if (cookies.length === 0) return null;

		const cookieHeader = cookies
			.map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
			.join("; ");

		try {
			const response = await fetch(USAGE_API, {
				headers: {
					Cookie: cookieHeader,
					Accept: "application/json",
					"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
					Referer: "https://chatgpt.com/codex/cloud/settings/analytics",
				},
			});

			if (!response.ok) {
				if (!this.config.quiet) {
					console.log(
						`[OpenAIQuotaScraper] Direct API failed: ${response.status}`,
					);
				}
				return null;
			}

			const data = await response.json();
			const primaryWindow = data?.rate_limit?.primary_window;
			const weeklyUsedPct = primaryWindow?.used_percent ?? 0;
			const resetAfterSeconds = primaryWindow?.reset_after_seconds ?? 0;
			const resetAtEpoch = primaryWindow?.reset_at;
			const weeklyResetsAt = formatRemainsSeconds(resetAfterSeconds);

			return {
				provider: "openai",
				weeklyUsedPct,
				weeklyResetsAt,
				weeklyResetsAtEpoch: resetAtEpoch ? resetAtEpoch * 1000 : undefined,
				resetAfterSeconds,
				apiEndpoint: USAGE_API,
				scrapedAt: new Date().toISOString(),
			};
		} catch (error) {
			if (!this.config.quiet) {
				console.warn(
					"[OpenAIQuotaScraper] Direct API error:",
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
export class OpenAIQuotaManager {
	private scraper: OpenAIQuotaScraper;
	private lastQuota?: OpenAIQuotaData;
	private lastFetchTime = 0;
	private readonly cacheDurationMs: number;

	constructor(config: OpenAIScraperConfig & { cacheDurationMs?: number } = {}) {
		this.scraper = new OpenAIQuotaScraper(config);
		this.cacheDurationMs = config.cacheDurationMs ?? 5 * 60 * 1000; // 5 min default
	}

	/**
	 * Get current quota (uses cache)
	 */
	async getQuota(forceRefresh = false): Promise<OpenAIQuotaData> {
		const now = Date.now();

		if (
			!forceRefresh &&
			this.lastQuota &&
			now - this.lastFetchTime < this.cacheDurationMs
		) {
			return this.lastQuota;
		}

		// Try direct API first (faster)
		const directResult = await this.scraper.scrapeDirect();
		if (directResult) {
			this.lastQuota = directResult;
			this.lastFetchTime = now;
			return this.lastQuota;
		}

		// Fall back to browser scrape
		try {
			this.lastQuota = await this.scraper.scrape();
			this.lastFetchTime = now;
			return this.lastQuota;
		} catch (error) {
			// Return cached value if available
			if (this.lastQuota) {
				return this.lastQuota;
			}
			throw error;
		}
	}

	/**
	 * Check if quota is available
	 */
	isAvailable(): boolean {
		return this.scraper.hasCookieFile();
	}
}
