/**
 * Playwright Adapter — RFC-0004
 *
 * Uses a persistent browser profile to read provider console information
 * when no official usage API exists. Initial target: MiniMax usage console.
 *
 * Also used as the E2E runner for testing workflows.
 */
// Dynamic import for Playwright (optional dependency)
let playwrightModule = null;
async function getPlaywright() {
    if (!playwrightModule) {
        try {
            playwrightModule = await import("playwright");
        }
        catch {
            console.warn("[PlaywrightRunner] Playwright not installed. E2E tests will be skipped.");
            return null;
        }
    }
    return playwrightModule;
}
export { MiniMaxQuotaScraper } from "./minimax-quota-scraper.js";
/**
 * Playwright E2E Runner for testing workflows
 *
 * Real implementation using Playwright library.
 */
export class PlaywrightE2ERunner {
    config;
    browser = null;
    context = null;
    page = null;
    constructor(config = {}) {
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
    async start() {
        const pw = await getPlaywright();
        if (!pw) {
            throw new Error("Playwright not available. Install with: bun add playwright");
        }
        const browserType = this.config.browser === "firefox"
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
    async stop() {
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
    async navigate(url) {
        if (!this.page)
            throw new Error("Browser not started");
        await this.page.goto(url, { timeout: this.config.timeout });
    }
    /**
     * Click an element
     */
    async click(selector) {
        if (!this.page)
            throw new Error("Browser not started");
        await this.page.waitForSelector(selector, { timeout: this.config.timeout });
        await this.page.click(selector);
    }
    /**
     * Type text into an input
     */
    async type(selector, text) {
        if (!this.page)
            throw new Error("Browser not started");
        await this.page.waitForSelector(selector, { timeout: this.config.timeout });
        await this.page.fill(selector, text);
    }
    /**
     * Wait for selector
     */
    async wait(selector, timeoutMs) {
        if (!this.page)
            throw new Error("Browser not started");
        await this.page.waitForSelector(selector, {
            timeout: timeoutMs ?? this.config.timeout,
        });
    }
    /**
     * Take a screenshot
     */
    async screenshot(path) {
        if (!this.page)
            throw new Error("Browser not started");
        await this.page.screenshot({ path, fullPage: true });
    }
    /**
     * Assert a condition
     */
    async assert(condition, message) {
        if (!this.page)
            throw new Error("Browser not started");
        const result = await this.page.evaluate((cond) => {
            // eslint-disable-next-line no-eval
            return eval(String(cond)); // eslint-disable-line
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
    async startTracing(_outputPath) {
        if (!this.page)
            throw new Error("Browser not started");
        await this.page
            .context()
            .tracing.start({ screenshots: true, snapshots: true });
    }
    /**
     * Stop tracing and save
     */
    async stopTracing(outputPath) {
        if (!this.page)
            throw new Error("Browser not started");
        await this.page.context().tracing.stop({ path: outputPath });
    }
}
