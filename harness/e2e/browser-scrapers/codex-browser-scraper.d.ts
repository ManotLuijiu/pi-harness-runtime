/**
 * Codex Browser Scraper — Scrapes chatgpt.com/codex/cloud/settings/analytics
 *
 * Uses Playwright with Chrome profile to access the authenticated page
 * and extract usage/quota data.
 */
import { BaseBrowserScraper } from "./base-browser-scraper.js";
export interface CodexQuotaData {
    provider: "openai-codex";
    /** Plan type (e.g., "pro", "plus") */
    planType?: string;
    /** Current usage percentage (0-100) */
    usagePercent: number;
    /** Total quota amount */
    totalQuota?: string;
    /** Used quota amount */
    usedQuota?: string;
    /** Remaining quota */
    remainingQuota?: string;
    /** Reset date/time */
    resetAt?: string;
    /** Usage period description */
    period?: string;
    /** Raw data for debugging */
    rawData?: Record<string, unknown>;
    /** Timestamp */
    scrapedAt: string;
}
interface CodexScraperConfig {
    provider?: string;
    url?: string;
    headless?: boolean;
    timeout?: number;
    viewport?: {
        width: number;
        height: number;
    };
    slowMo?: number;
}
/**
 * Codex Browser Scraper
 *
 * Scrapes usage data from chatgpt.com/codex/cloud/settings/analytics
 */
export declare class CodexBrowserScraper extends BaseBrowserScraper<CodexQuotaData> {
    constructor(config?: Partial<CodexScraperConfig>);
    protected createBrowser(): Promise<void>;
    private getProfileDir;
    protected isLoginPage(): Promise<boolean>;
    protected extractData(): Promise<CodexQuotaData | null>;
    private extractUsageData;
    private extractAdditionalData;
    private extractFromHeadings;
    private extractChartData;
}
/**
 * Quick scrape function
 */
export declare function scrapeCodexQuota(): Promise<CodexQuotaData | null>;
export {};
//# sourceMappingURL=codex-browser-scraper.d.ts.map