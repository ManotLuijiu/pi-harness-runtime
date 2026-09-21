/**
 * Base Browser Scraper — Abstract class for browser-based quota scraping
 *
 * Uses Playwright with Chrome profiles to scrape JavaScript-rendered pages
 * that require authentication. Similar approach to google-flow-mcp.
 */

import type { Page, Browser, BrowserContext } from "playwright";

export interface BrowserScraperConfig {
	/** Headless mode (default: true) */
	headless?: boolean;
	/** Page load timeout in ms (default: 30000) */
	timeout?: number;
	/** Viewport dimensions */
	viewport?: { width: number; height: number };
	/** Slow down operations by ms (for debugging) */
	slowMo?: number;
	/** Provider name for logging */
	provider: string;
	/** URL to scrape */
	url: string;
}

export interface QuotaScrapingResult<T> {
	/** Whether scraping was successful */
	success: boolean;
	/** The scraped data */
	data?: T;
	/** Error message if failed */
	error?: string;
	/** Timestamp of scrape */
	scrapedAt: string;
	/** Screenshot path if debug screenshot was taken */
	screenshotPath?: string;
}

/**
 * Abstract base class for browser-based quota scrapers
 */
export abstract class BaseBrowserScraper<T> {
	protected config: Required<BrowserScraperConfig>;
	protected browser: Browser | null = null;
	protected context: BrowserContext | null = null;
	protected page: Page | null = null;
	protected screenshotsEnabled = false;
	protected screenshotsDir = "/tmp/pi-harness-screenshots";

	constructor(config: BrowserScraperConfig) {
		this.config = {
			headless: config.headless ?? true,
			timeout: config.timeout ?? 30000,
			viewport: config.viewport ?? { width: 1280, height: 720 },
			slowMo: config.slowMo ?? 0,
			provider: config.provider,
			url: config.url,
		};
	}

	/**
	 * Initialize Playwright and launch browser
	 */
	protected abstract createBrowser(): Promise<void>;

	/**
	 * Take a debug screenshot
	 */
	async takeScreenshot(name: string): Promise<string | undefined> {
		if (!this.page) return undefined;

		try {
			const { existsSync, mkdirSync } = require("node:fs");
			const path = require("node:path");

			if (!existsSync(this.screenshotsDir)) {
				mkdirSync(this.screenshotsDir, { recursive: true });
			}

			const filePath = path.join(
				this.screenshotsDir,
				`${this.config.provider}-${name}-${Date.now()}.png`,
			);

			await this.page.screenshot({ path: filePath, fullPage: true });
			console.log(`[${this.config.provider}] Screenshot saved: ${filePath}`);
			return filePath;
		} catch {
			return undefined;
		}
	}

	/**
	 * Wait for a selector with retry logic
	 */
	protected async waitForSelector(
		selector: string,
		options?: { timeout?: number; state?: "attached" | "detached" | "visible" | "hidden" },
	): Promise<boolean> {
		if (!this.page) return false;

		try {
			await this.page.waitForSelector(selector, {
				timeout: options?.timeout ?? this.config.timeout,
				state: options?.state ?? "visible",
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Extract text content from page
	 */
	protected async extractText(selector: string): Promise<string | null> {
		if (!this.page) return null;

		try {
			const element = await this.page.$(selector);
			if (!element) return null;
			return await element.textContent();
		} catch {
			return null;
		}
	}

	/**
	 * Extract number from text (handles various formats like "1.5 GB", "$10.00", etc.)
	 */
	protected extractNumber(text: string | null, pattern?: RegExp): number | null {
		if (!text) return null;

		const cleaned = pattern ? text.match(pattern)?.[0] ?? text : text;
		const match = cleaned.match(/[\d,.]+/);
		if (!match) return null;

		const num = parseFloat(match[0].replace(/,/g, ""));
		return isNaN(num) ? null : num;
	}

	/**
	 * Main scraping method — navigates and extracts data
	 */
	async scrape(): Promise<QuotaScrapingResult<T>> {
		const result: QuotaScrapingResult<T> = {
			success: false,
			scrapedAt: new Date().toISOString(),
		};

		try {
			// Initialize browser
			await this.createBrowser();

			if (!this.page) {
				result.error = "Failed to create browser page";
				return result;
			}

			// Navigate to URL
			console.log(`[${this.config.provider}] Navigating to ${this.config.url}`);
			await this.page.goto(this.config.url, {
				waitUntil: "networkidle",
				timeout: this.config.timeout,
			});

			// Wait for page to settle
			await this.page.waitForTimeout(2000);

			// Take screenshot for debugging if enabled
			if (this.screenshotsEnabled) {
				await this.takeScreenshot("initial-load");
			}

			// Check if login is required
			if (await this.isLoginPage()) {
				result.error = "Login required - browser session not authenticated";
				await this.takeScreenshot("login-required");
				return result;
			}

			// Extract data using provider-specific logic
			const data = await this.extractData();
			if (!data) {
				result.error = "Failed to extract quota data from page";
				await this.takeScreenshot("extraction-failed");
				return result;
			}

			result.success = true;
			result.data = data;

		} catch (error) {
			result.error = error instanceof Error ? error.message : String(error);
			await this.takeScreenshot("error");

		} finally {
			await this.cleanup();
		}

		return result;
	}

	/**
	 * Check if current page is a login page
	 */
	protected abstract isLoginPage(): Promise<boolean>;

	/**
	 * Extract quota data from the page
	 */
	protected abstract extractData(): Promise<T | null>;

	/**
	 * Cleanup browser resources
	 */
	async cleanup(): Promise<void> {
		try {
			if (this.page) {
				await this.page.close();
				this.page = null;
			}
			if (this.context) {
				await this.context.close();
				this.context = null;
			}
			if (this.browser) {
				await this.browser.close();
				this.browser = null;
			}
		} catch {
			// Ignore cleanup errors
		}
	}

	/**
	 * Enable screenshot capture for debugging
	 */
	enableScreenshots(dir?: string): void {
		this.screenshotsEnabled = true;
		if (dir) {
			this.screenshotsDir = dir;
		}
	}
}
