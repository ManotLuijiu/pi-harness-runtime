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
import { BaseBrowserScraper } from "./base-browser-scraper.js";
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
    viewport?: {
        width: number;
        height: number;
    };
    slowMo?: number;
    /** Path to cookies file (Netscape format) */
    cookiesFile?: string;
}
/**
 * Z.ai Browser Scraper
 */
export declare class ZaiBrowserScraper extends BaseBrowserScraper<ZaiQuotaData> {
    private cookiesFile?;
    constructor(config?: Partial<ZaiScraperConfig>);
    /**
     * Find available cookies file
     */
    private findCookiesFile;
    protected createBrowser(): Promise<void>;
    /**
     * Load cookies from file and convert to headers (fallback auth method)
     * Note: This won't work for all sites - some require full cookie jar
     */
    private loadCookiesAsHeaders;
    protected isLoginPage(): Promise<boolean>;
    protected extractData(): Promise<ZaiQuotaData | null>;
    private extractUsagePercent;
    private extractPlanType;
    private extractQuotaData;
    private extractResetDate;
}
/**
 * Quick scrape function
 */
export declare function scrapeZaiQuota(cookiesFile?: string): Promise<ZaiQuotaData | null>;
/**
 * Check if z.ai cookies are available
 */
export declare function checkZaiCookies(): {
    available: boolean;
    path?: string;
};
export {};
//# sourceMappingURL=zai-browser-scraper.d.ts.map