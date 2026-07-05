/**
 * Playwright Adapter — RFC-0004
 *
 * Uses a persistent browser profile to read provider console information
 * when no official usage API exists. Initial target: MiniMax usage console.
 *
 * Also used as the E2E runner for testing workflows.
 */

// Dynamic import for Playwright (optional dependency)
let playwrightModule: typeof import("playwright") | null = null;

async function getPlaywright() {
	if (!playwrightModule) {
		try {
			playwrightModule = await import("playwright");
		} catch {
			console.warn(
				"[PlaywrightRunner] Playwright not installed. E2E tests will be skipped.",
			);
			return null;
		}
	}
	return playwrightModule;
}

export interface PlaywrightRunnerConfig {
	headless?: boolean;
	slowMo?: number;
	timeout?: number;
	browser?: "chromium" | "firefox" | "webkit";
	profileDir?: string;
	viewport?: { width: number; height: number };
}

// Forward-compatible runner interface for E2E Test Engine
export interface E2ERunner {
	navigate(url: string): Promise<void>;
	click(selector: string): Promise<void>;
	type(selector: string, text: string): Promise<void>;
	wait(selector: string, timeout?: number): Promise<void>;
	screenshot(path: string): Promise<void>;
	assert(condition: string, message?: string): Promise<boolean>;
}

export interface QuotaPageData {
	provider: string;
	h5UsedPct: number;
	h5ResetsAt?: string;
	weeklyUsedPct: number;
	weeklyResetsAt?: string;
	dailyUsedPct?: number;
	dailyResetsAt?: string;
	raw?: string;
}

/**
 * MiniMax quota scraper using Playwright
 */
export class MiniMaxQuotaScraper {
	private config: PlaywrightRunnerConfig;

	constructor(config: PlaywrightRunnerConfig = {}) {
		this.config = {
			headless: true,
			timeout: 30000,
			browser: "chromium",
			...config,
		};
	}

	/**
	 * Scrape quota data from MiniMax console
	 */
	async scrape(): Promise<QuotaPageData> {
		// In a real implementation, this would use playwright
		// For now, return a placeholder
		return {
			provider: "minimax",
			h5UsedPct: 0,
			weeklyUsedPct: 0,
			raw: "Playwright integration placeholder",
		};
	}

	/**
	 * Wait for quota data to load
	 */
	async waitForQuotaLoad(page: any, timeoutMs?: number): Promise<void> {
		const selectors = [
			".quota-used",
			".usage-percentage",
			"[data-quota]",
			".limit-bar",
		];

		const timeout = timeoutMs ?? this.config.timeout ?? 30000;

		for (const selector of selectors) {
			try {
				await page.waitForSelector(selector, { timeout });
				return;
			} catch {
				// Try next selector
			}
		}

		throw new Error("Could not find quota element on page");
	}

	/**
	 * Parse quota percentage from text
	 */
	parsePercentage(text: string): number {
		const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
		return match ? parseFloat(match[1]) : 0;
	}

	/**
	 * Parse reset time from text
	 */
	parseResetTime(text: string): string | undefined {
		// Examples: "Resets in 4 hr 56 min", "Resets in 2d 13h"
		const match = text.match(/Resets?\s+in\s+(\d+d\s*)?(\d+h\s*)?(\d+m?)?/i);
		if (!match) return undefined;

		const parts = [];
		if (match[1]) parts.push(match[1]);
		if (match[2]) parts.push(match[2]);
		if (match[3]) parts.push(match[3]);

		return parts.join("").trim();
	}
}

/**
 * Playwright E2E Runner for testing workflows
 *
 * Real implementation using Playwright library.
 */
export class PlaywrightE2ERunner implements E2ERunner {
	private config: PlaywrightRunnerConfig;
	private browser: any = null;
	private context: any = null;
	private page: any = null;

	constructor(config: PlaywrightRunnerConfig = {}) {
		this.config = {
			headless: true,
			slowMo: 0,
			timeout: 30000,
			browser: "chromium",
			...config,
		};
	}

	/**
	 * Start the browser
	 */
	async start(): Promise<void> {
		const pw = await getPlaywright();
		if (!pw) {
			throw new Error(
				"Playwright not available. Install with: bun add playwright",
			);
		}

		const browserType =
			this.config.browser === "firefox"
				? pw.firefox
				: this.config.browser === "webkit"
					? pw.webkit
					: pw.chromium;

		this.browser = await browserType.launch({
			headless: this.config.headless,
			slowMo: this.config.slowMo,
		});

		this.context = await this.browser.newContext({
			viewport: this.config.viewport ?? { width: 1280, height: 720 },
		});

		this.page = await this.context.newPage();
	}

	/**
	 * Stop the browser
	 */
	async stop(): Promise<void> {
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
	}

	/**
	 * Navigate to a URL
	 */
	async navigate(url: string): Promise<void> {
		if (!this.page) throw new Error("Browser not started");
		await this.page.goto(url, { timeout: this.config.timeout });
	}

	/**
	 * Click an element
	 */
	async click(selector: string): Promise<void> {
		if (!this.page) throw new Error("Browser not started");
		await this.page.waitForSelector(selector, { timeout: this.config.timeout });
		await this.page.click(selector);
	}

	/**
	 * Type text into an input
	 */
	async type(selector: string, text: string): Promise<void> {
		if (!this.page) throw new Error("Browser not started");
		await this.page.waitForSelector(selector, { timeout: this.config.timeout });
		await this.page.fill(selector, text);
	}

	/**
	 * Wait for selector
	 */
	async wait(selector: string, timeoutMs?: number): Promise<void> {
		if (!this.page) throw new Error("Browser not started");
		await this.page.waitForSelector(selector, {
			timeout: timeoutMs ?? this.config.timeout,
		});
	}

	/**
	 * Take a screenshot
	 */
	async screenshot(path: string): Promise<void> {
		if (!this.page) throw new Error("Browser not started");
		await this.page.screenshot({ path, fullPage: true });
	}

	/**
	 * Assert a condition
	 */
	async assert(condition: string, message?: string): Promise<boolean> {
		if (!this.page) throw new Error("Browser not started");

		const result = await this.page.evaluate((cond: unknown) => {
			// eslint-disable-next-line no-eval
			return eval(String(cond)) as boolean; // eslint-disable-line
		}, condition);

		if (!result && message) {
			throw new Error(message);
		}

		return result;
	}

	/**
	 * Get the underlying page for advanced operations
	 */
	getPage() {
		return this.page;
	}

	/**
	 * Start tracing for debugging
	 */
	async startTracing(_outputPath: string): Promise<void> {
		if (!this.page) throw new Error("Browser not started");
		await this.page
			.context()
			.tracing.start({ screenshots: true, snapshots: true });
	}

	/**
	 * Stop tracing and save
	 */
	async stopTracing(outputPath: string): Promise<void> {
		if (!this.page) throw new Error("Browser not started");
		await this.page.context().tracing.stop({ path: outputPath });
	}
}
