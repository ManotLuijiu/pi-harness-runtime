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

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseMiniMaxQuotaText } from "./minimax-quota-parser.js";

export interface MiniMaxQuotaData {
	provider: "minimax";
	/** 5-hour window usage percentage (0-100) */
	h5UsedPct: number;
	/** When the 5h window resets (e.g., "in 4 hr 56 min") */
	h5ResetsAt?: string;
	/** Epoch ms when the 5h window resets — precise UTC timestamp. */
	h5ResetsAtEpoch?: number;
	/** Weekly usage percentage (0-100) */
	weeklyUsedPct: number;
	/** When the weekly window resets */
	weeklyResetsAt?: string;
	/** Epoch ms when the weekly window resets — precise UTC timestamp. */
	weeklyResetsAtEpoch?: number;
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
	/** Suppress console output — for background/auto-fetch use */
	quiet?: boolean;
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
 * Parse a percentage string like "50%" or "2%" into a number.
 */
function parsePctStr(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const m = value.match(/(\d+(?:\.\d+)?)/);
	return m ? parseFloat(m[1]) : undefined;
}

/**
 * Format remaining time until an epoch-ms deadline (e.g. "4 hr 37 min").
 */
function formatRemainsMs(epochMs: number | undefined): string | undefined {
	if (typeof epochMs !== "number" || epochMs <= 0) return undefined;
	const ms = epochMs - Date.now();
	if (ms <= 0) return "soon";
	const totalMin = Math.floor(ms / 60000);
	const days = Math.floor(totalMin / 1440);
	const hr = Math.floor((totalMin % 1440) / 60);
	const min = totalMin % 60;
	const parts: string[] = [];
	if (days > 0) parts.push(`${days} day${days > 1 ? "s" : ""}`);
	if (hr > 0) parts.push(`${hr} hr`);
	if (min > 0) parts.push(`${min} min`);
	return parts.join(" ") || "0 min";
}

/**
 * MiniMax Quota Scraper
 *
 * Uses headless Playwright to fetch quota data from the MiniMax console.
 */
export class MiniMaxQuotaScraper {
	private readonly config: Required<MiniMaxScraperConfig>;
	private capturedEndpoints: string[] = [];

	constructor(config: MiniMaxScraperConfig = {}) {
		this.config = {
			cookieFile: config.cookieFile ?? DEFAULT_COOKIE_FILE,
			url: config.url ?? DEFAULT_URL,
			headless: config.headless ?? true,
			timeout: config.timeout ?? 90000,
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
	 * Set MiniMax console URL
	 */
	setUrl(url: string): this {
		this.config.url = url;
		return this;
	}

	/**
	 * Scrape quota data. Tries the direct MiniMax API first (fast, no
	 * browser — ~200ms), then falls back to a headless browser scrape.
	 */
	async scrape(): Promise<MiniMaxQuotaData> {
		try {
			const apiData = await this.scrapeViaDirectApi();
			if (apiData) {
				if (!this.config.quiet) {
					console.log("[MiniMaxQuotaScraper] direct API success");
				}
				return apiData;
			}
			if (!this.config.quiet) {
				console.log(
					"[MiniMaxQuotaScraper] direct API unavailable, falling back to browser",
				);
			}
		} catch (error) {
			if (!this.config.quiet) {
				console.warn(
					"[MiniMaxQuotaScraper] direct API failed:",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		return this.scrapeViaBrowser();
	}

	/**
	 * Fetch quota directly from the MiniMax API using cookies (no browser).
	 * Uses the same cookie file as the browser path. Returns null when not
	 * authenticated so the caller can decide whether to fall back.
	 */
	private async scrapeViaDirectApi(): Promise<MiniMaxQuotaData | null> {
		const cookies = loadNetscapeCookies(this.config.cookieFile!);
		if (cookies.length === 0) return null;

		const cookieHeader = cookies
			.map((c) => `${c.name}=${String(c.value).trim()}`)
			.join("; ");

		const headers: Record<string, string> = {
			Cookie: cookieHeader,
			Accept: "application/json, text/plain, */*",
			"User-Agent": "Mozilla/5.0",
			Referer: "https://platform.minimax.io/console/usage",
		};
		const base = "https://platform.minimax.io";

		// Primary: remains_percent gives 5h + weekly used % and reset times
		let general: Record<string, unknown> | null = null;
		try {
			const resp = await fetch(
				`${base}/backend/account/token_plan/remains_percent`,
				{ headers },
			);
			if (resp.ok) {
				const json = (await resp.json()) as {
					model_remains?: Array<Record<string, unknown>>;
				};
				const arr = json?.model_remains;
				if (Array.isArray(arr)) {
					general =
						arr.find((m) => m.model_name === "general") ?? arr[0] ?? null;
				}
			}
		} catch {
			/* fall through to null */
		}

		// Not authenticated (or request failed) → no data
		if (!general) return null;

		const h5UsedPct = parsePctStr(
			general.current_interval_used_percent as unknown,
		);
		const weeklyUsedPct = parsePctStr(
			general.current_weekly_used_percent as unknown,
		);
		const h5ResetsAtEpoch = general.end_time as number | undefined;
		const h5ResetsAt = formatRemainsMs(h5ResetsAtEpoch);
		const weeklyResetsAtEpoch = general.weekly_end_time as number | undefined;
		const weeklyResetsAt = formatRemainsMs(weeklyResetsAtEpoch);

		// Best-effort: token usage summary
		let tokenUsage: MiniMaxQuotaData["tokenUsage"];
		try {
			const resp = await fetch(
				`${base}/backend/account/token_plan/usage_summary`,
				{ headers },
			);
			if (resp.ok) {
				const json = (await resp.json()) as {
					total_token_consumed?: string;
				};
				if (json?.total_token_consumed) {
					tokenUsage = {
						total: json.total_token_consumed,
						last30Days: "",
						last7Days: "",
						currentMonth: "",
					};
				}
			}
		} catch {
			/* best-effort */
		}

		// Best-effort: credit balance. NOTE: the API response includes an
		// `api_key` field — we deliberately do NOT read or persist it.
		let creditBalance: string | undefined;
		try {
			const resp = await fetch(`${base}/backend/account/token_plan_credit`, {
				headers,
			});
			if (resp.ok) {
				const json = (await resp.json()) as {
					remaining_credits?: number;
					total_credits?: number;
				};
				if (
					typeof json?.remaining_credits === "number" &&
					typeof json?.total_credits === "number"
				) {
					creditBalance = `${json.remaining_credits} / ${json.total_credits}`;
				}
			}
		} catch {
			/* best-effort */
		}

		return {
			provider: "minimax",
			h5UsedPct: h5UsedPct ?? 0,
			h5ResetsAt,
			h5ResetsAtEpoch,
			weeklyUsedPct: weeklyUsedPct ?? 0,
			weeklyResetsAt,
			weeklyResetsAtEpoch,
			creditBalance,
			tokenUsage,
			apiEndpoints: [
				`${base}/backend/account/token_plan/remains_percent`,
				`${base}/backend/account/token_plan/usage_summary`,
				`${base}/backend/account/token_plan_credit`,
			],
			scrapedAt: new Date().toISOString(),
		};
	}

	/**
	 * Scrape quota data from MiniMax console using a headless browser.
	 */
	private async scrapeViaBrowser(): Promise<MiniMaxQuotaData> {
		// Dynamic import for Playwright
		let playwright: typeof import("playwright") | null = null;
		try {
			playwright = await import("playwright");
		} catch {
			const msg =
				"Playwright not installed. Install with: bun add playwright\nThen install browsers: bunx playwright install chromium";
			if (!this.config.quiet) console.error("[MiniMaxQuotaScraper] " + msg);
			throw new Error(msg);
		}

		// Pre-load the canonical cache so that the runtime-owned file
		// (written by packages/cookie-sanitizer) takes precedence over
		// whatever `this.config.cookieFile` points at. Both eventually
		// resolve to the same standard Netscape format.
		const cookies = loadNetscapeCookies(this.config.cookieFile!);

		if (cookies.length === 0) {
			const dropHint = join(homedir(), ".pi-harness-runtime", "cookies");
			const msg =
				`No cookies found.\n` +
				`Drop your platform.minimax.io cookies (Netscape or EditThisCookie JSON) into:\n` +
				`  ${dropHint}\n` +
				`…or run: bun packages/auth/src/run-minimax-auth.ts auth`;
			if (!this.config.quiet) console.error("[MiniMaxQuotaScraper] " + msg);
			throw new Error(msg);
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
			const quotaData = parseMiniMaxQuotaText(visibleText);

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
	 * Check if any cookie source exists.
	 *
	 * "Source" can be either:
	 *   - the canonical cache (this.config.cookieFile) — runtime-owned,
	 *     populated by packages/cookie-sanitizer
	 *   - the user-facing drop folder — ~/.pi-harness-runtime/cookies/
	 *     — populated by humans (any name, any format)
	 *
	 * Either is enough to attempt the scrape.
	 */
	hasCookieFile(): boolean {
		// Canonical cache present?
		if (existsSync(this.config.cookieFile!)) return true;

		// Drop folder has anything readable? (Sync would normalize it on the next trigger.)
		try {
			const dropDir = join(homedir(), ".pi-harness-runtime", "cookies");
			if (existsSync(dropDir)) {
				const entries = readdirSync(dropDir);
				if (entries.length > 0) return true;
				// One-level walk into subfolders.
				for (const name of entries) {
					try {
						if (statSync(join(dropDir, name)).isDirectory()) {
							const sub = readdirSync(join(dropDir, name));
							if (sub.length > 0) return true;
						}
					} catch {
						// ignore unreadable sub-entry
					}
				}
			}
		} catch {
			// best-effort; treat as no
		}

		return false;
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
