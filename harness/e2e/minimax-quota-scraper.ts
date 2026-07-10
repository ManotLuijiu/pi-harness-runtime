/**
 * MiniMax Quota Scraper — RFC-0031
 *
 * Automatically fetches quota data from MiniMax console using Playwright.
 * Uses cookie-based authentication to access the usage page.
 *
 * Based on the tactic in pi-harness-runtime/AGENTS.md:
 * - Cookie-backed fetch returns static HTML only
 * - Must use headless Playwright with injected cookies
 * - Capture API responses for usage data
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface MiniMaxQuotaData {
	provider: "minimax";
	/** 5-hour window usage percentage (0-100) */
	h5UsedPct: number;
	/** When the 5h window resets (e.g., "in 4 hr 56 min") */
	h5ResetsAt?: string;
	/** Weekly usage percentage (0-100) */
	weeklyUsedPct: number;
	/** When the weekly window resets */
	weeklyResetsAt?: string;
	/** Monthly usage percentage (0-100) */
	monthlyUsedPct?: number;
	/** When the monthly window resets */
	monthlyResetsAt?: string;
	/** Credit balance remaining */
	creditBalance?: string;
	/** Token usage stats */
	tokenUsage?: {
		currentMonth: string;
		last7Days: string;
		last30Days: string;
		total: string;
	};
	/** Raw API responses captured */
	apiEndpoints?: string[];
	/** Timestamp of scrape */
	scrapedAt: string;
}

export interface MiniMaxScraperConfig {
	/** Path to Netscape-format cookie file */
	cookieFile?: string;
	/** MiniMax console URL */
	url?: string;
	/** Headless mode (default: true) */
	headless?: boolean;
	/** Timeout in ms (default: 90000) */
	timeout?: number;
	/** Chrome executable path (optional) */
	chromePath?: string;
}

const DEFAULT_URL = "https://platform.minimax.io/console/usage?cycle_type=1";
const DEFAULT_COOKIE_FILE = join(homedir(), ".config", "minimax-cookies.txt");

// API endpoints to capture
const API_TERMS = [
	"api",
	"usage",
	"billing",
	"quota",
	"consumption",
	"recharge",
	"resource",
	"plan",
	"subscription",
	"token_plan",
];

/**
 * Load Netscape-format cookies from file
 */
function loadNetscapeCookies(path: string): Array<{
	name: string;
	value: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	expires?: number;
}> {
	const cookies: Array<{
		name: string;
		value: string;
		domain: string;
		path: string;
		secure: boolean;
		httpOnly: boolean;
		expires?: number;
	}> = [];

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
 * Redact sensitive values from text
 */
function redact(text: string): string {
	return text
		.replace(
			/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
			"[JWT_REDACTED]",
		)
		.replace(
			/api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie|session|secret/gi,
			(match) => `${match}=[REDACTED]`,
		)
		.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

/**
 * MiniMax Quota Scraper
 *
 * Uses headless Playwright to fetch quota data from the MiniMax console.
 */
export class MiniMaxQuotaScraper {
	private readonly config: MiniMaxScraperConfig;
	private capturedEndpoints: string[] = [];

	constructor(config: MiniMaxScraperConfig = {}) {
		this.config = {
			cookieFile: DEFAULT_COOKIE_FILE,
			url: DEFAULT_URL,
			headless: true,
			timeout: 90000,
			...config,
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
	 * Set MiniMax console URL
	 */
	setUrl(url: string): this {
		this.config.url = url;
		return this;
	}

	/**
	 * Scrape quota data from MiniMax console
	 */
	async scrape(): Promise<MiniMaxQuotaData> {
		// Dynamic import for Playwright
		let playwright: typeof import("playwright") | null = null;
		try {
			playwright = await import("playwright");
		} catch {
			throw new Error(
				"Playwright not installed. Install with: bun add playwright\n" +
					"Then install browsers: bunx playwright install chromium",
			);
		}

		const cookies = loadNetscapeCookies(this.config.cookieFile!);

		if (cookies.length === 0) {
			throw new Error(
				`No cookies found in ${this.config.cookieFile}\n` +
					"Export cookies from browser in Netscape format.",
			);
		}

		// Launch browser
		const browser = await playwright.chromium.launch({
			executablePath: this.config.chromePath,
			headless: this.config.headless,
			args: ["--no-sandbox", "--disable-dev-shm-usage"],
		});

		const context = await browser.newContext({
			locale: "en-US",
			viewport: { width: 1440, height: 1000 },
		});

		// Inject cookies
		await context.addCookies(cookies);

		const page = await context.newPage();
		const capturedResponses: Array<{
			url: string;
			body: string;
		}> = [];

		// Capture API responses
		page.on("response", (resp) => {
			const url = resp.url();
			if (API_TERMS.some((term) => url.toLowerCase().includes(term))) {
				capturedResponses.push({
					url,
					body: "",
				});
				// We capture the URL, body will be fetched later
			}
		});

		try {
			// Navigate to usage page
			await page.goto(this.config.url!, {
				waitUntil: "domcontentloaded",
				timeout: this.config.timeout,
			});

			// Wait for content to load
			try {
				await page.waitForLoadState("networkidle", { timeout: 45000 });
			} catch {
				// Network idle might not be achievable
			}

			// Additional wait for JS rendering
			await page.waitForTimeout(5000);

			// Extract visible text
			const visibleText = redact(
				await page.locator("body").innerText({ timeout: 10000 }),
			);

			// Parse the visible text
			const quotaData = this.parseVisibleText(visibleText);

			// Capture API endpoint URLs
			this.capturedEndpoints = capturedResponses.map((r) => r.url);

			const result: MiniMaxQuotaData = {
				provider: "minimax",
				h5UsedPct: quotaData.h5UsedPct ?? 0,
				h5ResetsAt: quotaData.h5ResetsAt,
				weeklyUsedPct: quotaData.weeklyUsedPct ?? 0,
				weeklyResetsAt: quotaData.weeklyResetsAt,
				monthlyUsedPct: quotaData.monthlyUsedPct,
				monthlyResetsAt: quotaData.monthlyResetsAt,
				creditBalance: quotaData.creditBalance,
				tokenUsage: quotaData.tokenUsage,
				apiEndpoints: this.capturedEndpoints,
				scrapedAt: new Date().toISOString(),
			};
			return result;
		} finally {
			await browser.close();
		}
	}

	/**
	 * Parse quota data from visible page text
	 */
	private parseVisibleText(text: string): Partial<MiniMaxQuotaData> {
		const data: Partial<MiniMaxQuotaData> = {};

		// Parse 5h limit
		const h5Match = text.match(/5h.*?(\d+(?:\.\d+)?)\s*%/s);
		if (h5Match) {
			data.h5UsedPct = parseFloat(h5Match[1]);
		}

		// Parse 5h reset time
		const h5ResetMatch = text.match(/5h.*?Resets?\s+in\s+([^.]+)/s);
		if (h5ResetMatch) {
			data.h5ResetsAt = h5ResetMatch[1].trim();
		}

		// Parse weekly limit
		const weeklyMatch = text.match(/week[^)]*?(\d+(?:\.\d+)?)\s*%/s);
		if (weeklyMatch) {
			data.weeklyUsedPct = parseFloat(weeklyMatch[1]);
		}

		// Parse weekly reset time
		const weeklyResetMatch = text.match(/Resets?\s+in\s+([^%\n]+?)(?:\s*%|$)/s);
		if (weeklyResetMatch) {
			data.weeklyResetsAt = weeklyResetMatch[1].trim();
		}

		// Parse credit balance
		const creditMatch = text.match(/credit[^:]*:\s*([^\n]+)/i);
		if (creditMatch) {
			data.creditBalance = creditMatch[1].trim();
		}

		// Parse token usage
		const tokenSectionMatch = text.match(
			/token[^:]*:?\s*([\d.,]+\s*(?:M|B|K)?\s*tokens?)/gi,
		);
		if (tokenSectionMatch) {
			data.tokenUsage = {
				currentMonth: tokenSectionMatch[0] || "",
				last7Days: tokenSectionMatch[1] || "",
				last30Days: tokenSectionMatch[2] || "",
				total: tokenSectionMatch[3] || "",
			};
		}

		return data;
	}

	/**
	 * Check if cookie file exists
	 */
	hasCookieFile(): boolean {
		return existsSync(this.config.cookieFile!);
	}

	/**
	 * Get instructions for setting up cookies
	 */
	static getSetupInstructions(): string {
		return `
MiniMax Quota Scraper Setup Instructions
======================================

1. Install Playwright:
   bun add playwright
   bunx playwright install chromium

2. Export cookies from your browser:
   - Install "EditThisCookie" Chrome extension
   - Go to https://platform.minimax.io
   - Click the extension icon
   - Click "Export" → "Netscape"
   - Save to ~/.config/minimax-cookies.txt

3. Use the scraper:
   const scraper = new MiniMaxQuotaScraper();
   const quota = await scraper.scrape();
   console.log("5h usage:", quota.h5UsedPct, "%");
`;
	}
}

// ─── Quota Manager Integration ───────────────────────────────────────────────

/**
 * Quota Manager that periodically fetches MiniMax quota data
 */
export class MiniMaxQuotaManager {
	private scraper: MiniMaxQuotaScraper;
	private lastQuota?: MiniMaxQuotaData;
	private lastFetchTime = 0;
	private readonly cacheDurationMs: number;

	constructor(
		config: MiniMaxScraperConfig & { cacheDurationMs?: number } = {},
	) {
		this.scraper = new MiniMaxQuotaScraper(config);
		this.cacheDurationMs = config.cacheDurationMs ?? 5 * 60 * 1000; // 5 min default
	}

	/**
	 * Get current quota (uses cache)
	 */
	async getQuota(forceRefresh = false): Promise<MiniMaxQuotaData> {
		const now = Date.now();

		if (
			!forceRefresh &&
			this.lastQuota &&
			now - this.lastFetchTime < this.cacheDurationMs
		) {
			return this.lastQuota;
		}

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
