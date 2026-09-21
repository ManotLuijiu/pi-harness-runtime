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
    viewport?: {
        width: number;
        height: number;
    };
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
export declare abstract class BaseBrowserScraper<T> {
    protected config: Required<BrowserScraperConfig>;
    protected browser: Browser | null;
    protected context: BrowserContext | null;
    protected page: Page | null;
    protected screenshotsEnabled: boolean;
    protected screenshotsDir: string;
    constructor(config: BrowserScraperConfig);
    /**
     * Initialize Playwright and launch browser
     */
    protected abstract createBrowser(): Promise<void>;
    /**
     * Take a debug screenshot
     */
    takeScreenshot(name: string): Promise<string | undefined>;
    /**
     * Wait for a selector with retry logic
     */
    protected waitForSelector(selector: string, options?: {
        timeout?: number;
        state?: "attached" | "detached" | "visible" | "hidden";
    }): Promise<boolean>;
    /**
     * Extract text content from page
     */
    protected extractText(selector: string): Promise<string | null>;
    /**
     * Extract number from text (handles various formats like "1.5 GB", "$10.00", etc.)
     */
    protected extractNumber(text: string | null, pattern?: RegExp): number | null;
    /**
     * Main scraping method — navigates and extracts data
     */
    scrape(): Promise<QuotaScrapingResult<T>>;
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
    cleanup(): Promise<void>;
    /**
     * Enable screenshot capture for debugging
     */
    enableScreenshots(dir?: string): void;
}
