/**
 * Z.ai Browser Scraper — Scrapes z.ai usage data
 *
 * Authentication approach:
 * - Z.ai uses cookies from browser login (different from ChatGPT)
 * - Cookies from ~/.config/google-chrome or browser export need to be tested
 * - Fallback: Manual cookie export from browser DevTools
 *
 * Note: If cookies don't work for browser automation (like Codex),
 * we may need to find alternative auth methods (OAuth, API keys, etc.)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { BaseBrowserScraper, type BrowserScraperConfig } from "./base-browser-scraper.js";

export interface ZaiQuotaData {
	provider: "z-ai";
	/** Plan type (e.g., "Pro", "Team", "Enterprise") */
	planType?: string;
	/** Current usage percentage (0-100) */
	usagePercent: number;
	/** Total quota (e.g., "5 GB") */
	totalQuota?: string;
	/** Used quota (e.g., "1.5 GB") */
	usedQuota?: string;
	/** Remaining quota */
	remainingQuota?: string;
	/** Reset date/time */
	resetAt?: string;
	/** Billing period */
	period?: string;
	/** Timestamp */
	scrapedAt: string;
}

interface ZaiScraperConfig {
	provider?: string;
	url?: string;
	headless?: boolean;
	timeout?: number;
	viewport?: { width: number; height: number };
	slowMo?: number;
	/** Path to cookies file (Netscape format) */
	cookiesFile?: string;
}

// Known cookie file locations to try
const COOKIE_LOCATIONS = [
	// Chrome Linux
	join(homedir(), ".config", "google-chrome", "Default", "Cookies"),
	join(homedir(), ".config", "google-chrome", "Default", "Network", "Cookies"),
	join(homedir(), ".config", "chromium", "Default", "Cookies"),
	// Netscape cookie format exports
	join(homedir(), ".pi-harness-runtime", "cookies", "zai-cookies.txt"),
	join(homedir(), ".config", "zai-cookies.txt"),
];

/**
 * Z.ai Browser Scraper
 */
export class ZaiBrowserScraper extends BaseBrowserScraper<ZaiQuotaData> {
	private cookiesFile?: string;

	constructor(config: Partial<ZaiScraperConfig> = {}) {
		super({
			provider: "z-ai",
			url: config.url ?? "https://z.ai/manage-apikey/coding-plan/personal/usage",
			headless: config.headless ?? true,
			timeout: config.timeout ?? 30000,
			viewport: config.viewport,
			slowMo: config.slowMo,
		});

		this.cookiesFile = config.cookiesFile ?? this.findCookiesFile();
	}

	/**
	 * Find available cookies file
	 */
	private findCookiesFile(): string | undefined {
		for (const location of COOKIE_LOCATIONS) {
			if (existsSync(location)) {
				return location;
			}
		}
		return undefined;
	}

	protected async createBrowser(): Promise<void> {
		const { chromium } = await import("playwright");

		const profileDir = join(homedir(), ".pi-harness-runtime", "browser-profiles", "zai");

		// Launch with anti-detection args
		this.browser = await chromium.launch({
			headless: this.config.headless,
			slowMo: this.config.slowMo,
			args: [
				`--user-data-dir=${profileDir}`,
				"--disable-blink-features=AutomationControlled",
				"--no-first-run",
				"--no-default-browser-check",
				"--disable-extensions",
			],
		});

		this.context = await this.browser.newContext({
			viewport: this.config.viewport,
			// If we have a cookies file, import it
			...(this.cookiesFile && existsSync(this.cookiesFile)
				? { extraHTTPHeaders: await this.loadCookiesAsHeaders() }
				: {}),
		});

		this.page = await this.context.newPage();
	}

	/**
	 * Load cookies from file and convert to headers (fallback auth method)
	 * Note: This won't work for all sites - some require full cookie jar
	 */
	private async loadCookiesAsHeaders(): Promise<Record<string, string>> {
		if (!this.cookiesFile || !existsSync(this.cookiesFile)) {
			return {};
		}

		try {
			// Try to parse as Netscape format
			const content = readFileSync(this.cookiesFile, "utf-8");
			const lines = content.split("\n").filter((l) => !l.startsWith("#") && l.trim());

			// Extract session-relevant cookies
			const cookies: Record<string, string> = {};
			for (const line of lines) {
				const parts = line.split("\t");
				if (parts.length >= 7) {
					const domain = parts[0];
					const name = parts[5];
					const value = parts[6];

					// Only include z.ai cookies
					if (domain.includes("z.ai") || domain.includes("zcloud")) {
						cookies[name] = value;
					}
				}
			}

			// Return as Cookie header
			const cookieHeader = Object.entries(cookies)
				.map(([k, v]) => `${k}=${v}`)
				.join("; ");

			return cookieHeader ? { Cookie: cookieHeader } : {};
		} catch {
			return {};
		}
	}

	protected async isLoginPage(): Promise<boolean> {
		if (!this.page) return false;

		const url = this.page.url();

		// Check for login/ auth URLs
		if (/signin|login|auth|oauth/i.test(url)) {
			return true;
		}

		// Check for common login indicators
		const loginSelectors = [
			'button:has-text("Sign in")',
			'button:has-text("Login")',
			'input[type="email"]',
			'input[placeholder*="email" i]',
			'form[action*="login" i]',
		];

		for (const selector of loginSelectors) {
			try {
				const element = await this.page.$(selector);
				if (element != null) {
					return true;
				}
			} catch {
				// Selector might not exist
			}
		}

		return false;
	}

	protected async extractData(): Promise<ZaiQuotaData | null> {
		if (!this.page) return null;

		try {
			// Wait for page to fully load
			await this.page.waitForTimeout(3000);

			// Extract usage percentage
			const usagePercent = await this.extractUsagePercent();
			if (usagePercent === null) {
				console.log("[z.ai] Could not extract usage percentage");
				return null;
			}

			// Extract additional data
			const planType = await this.extractPlanType();
			const quotaData = await this.extractQuotaData();
			const resetAt = await this.extractResetDate();

			return {
				provider: "z-ai",
				usagePercent,
				planType,
				...quotaData,
				resetAt,
				scrapedAt: new Date().toISOString(),
			};
		} catch (error) {
			console.error(`[z.ai] Extraction error: ${error}`);
			return null;
		}
	}

	private async extractUsagePercent(): Promise<number | null> {
		if (!this.page) return null;

		// Try various selectors for usage percentage
		const selectors = [
			// Percentage text
			'text=/\\d+%/',
			// Progress bar/circle with percentage
			"[class*='progress'] [class*='text']",
			"[class*='usage'] [class*='percent']",
			"[class*='quota'] [class*='percent']",
			// Heading near percentage
			"h1:has-text('Usage') + div",
			"h2:has-text('Usage') + div",
			// Data attributes
			"[data-usage]",
			"[data-percent]",
			"[data-quota]",
		];

		for (const selector of selectors) {
			try {
				const element = await this.page.$(selector);
				if (element) {
					const text = await element.textContent();
					const match = text?.match(/(\d+(?:\.\d+)?)\s*%/);
					if (match) {
						const percent = parseFloat(match[1]);
						if (!isNaN(percent) && percent >= 0 && percent <= 100) {
							return percent;
						}
					}
				}
			} catch {
				// Continue to next selector
			}
		}

		return null;
	}

	private async extractPlanType(): Promise<string | undefined> {
		if (!this.page) return undefined;

		const selectors = [
			"[class*='plan']",
			"[class*='tier']",
			'text=/Pro|Team|Enterprise|Starter/i',
		];

		for (const selector of selectors) {
			try {
				const element = await this.page.$(selector);
				if (element) {
					const text = await element.textContent();
					if (text && /Pro|Team|Enterprise|Starter/i.test(text)) {
						return text.trim();
					}
				}
			} catch {
				// Continue
			}
		}

		return undefined;
	}

	private async extractQuotaData(): Promise<{
		totalQuota?: string;
		usedQuota?: string;
		remainingQuota?: string;
	}> {
		if (!this.page) return {};

		const result: { totalQuota?: string; usedQuota?: string; remainingQuota?: string } = {};

		// Try to find quota amounts like "1.5 GB / 5 GB"
		const selectors = [
			'text=/\\d+.*(?:GB|MB|TB).*(?:\\/|of).*(?:GB|MB|TB)/i',
			"[class*='quota'] [class*='amount']",
			"[class*='usage'] [class*='amount']",
		];

		for (const selector of selectors) {
			try {
				const element = await this.page.$(selector);
				if (element) {
					const text = await element.textContent();
					if (text) {
						// Parse "1.5 GB / 5 GB" format
						const match = text.match(/([\d,.]+)\s*(GB|MB|TB)\s*(?:\/|of)\s*([\d,.]+)\s*(GB|MB|TB)/i);
						if (match) {
							result.usedQuota = `${match[1]} ${match[2]}`;
							result.totalQuota = `${match[3]} ${match[4]}`;
							// Calculate remaining
							const used = parseFloat(match[1].replace(/,/g, ""));
							const total = parseFloat(match[3].replace(/,/g, ""));
							if (!isNaN(used) && !isNaN(total)) {
								const remaining = total - used;
								result.remainingQuota = `${remaining.toFixed(2)} ${match[4]}`;
							}
							break;
						}
					}
				}
			} catch {
				// Continue
			}
		}

		return result;
	}

	private async extractResetDate(): Promise<string | undefined> {
		if (!this.page) return undefined;

		const selectors = [
			'text=/resets?(?:\\s+(?:at|on|in))?\\s*/i',
			"[class*='reset']",
			"[class*='renews']",
			"[class*='billing'] [class*='date']",
		];

		for (const selector of selectors) {
			try {
				const element = await this.page.$(selector);
				if (element) {
					const text = await element.textContent();
					if (text && /\d{4}|resets?|renews|billing/i.test(text)) {
						return text.trim();
					}
				}
			} catch {
				// Continue
			}
		}

		return undefined;
	}
}

/**
 * Quick scrape function
 */
export async function scrapeZaiQuota(cookiesFile?: string): Promise<ZaiQuotaData | null> {
	const scraper = new ZaiBrowserScraper({ cookiesFile });
	try {
		const result = await scraper.scrape();
		return result.data ?? null;
	} finally {
		await scraper.cleanup();
	}
}

/**
 * Check if z.ai cookies are available
 */
export function checkZaiCookies(): { available: boolean; path?: string } {
	for (const location of COOKIE_LOCATIONS) {
		if (existsSync(location)) {
			return { available: true, path: location };
		}
	}
	return { available: false };
}
