/**
 * Browser Scrapers — Browser-based quota scraping via Playwright
 *
 * Authentication strategies by provider:
 *
 * | Provider  | Auth Method          | Cookies Work? | Notes                    |
 * |-----------|----------------------|---------------|--------------------------|
 * | MiniMax   | Browser cookies      | Yes           | Direct browser scraping  |
 * | ChatGPT   | OAuth tokens        | No            | Use ~/.codex/auth.json   |
 * | Codex     | OAuth tokens        | No            | Use ~/.codex/auth.json   |
 * | Z.ai      | Browser cookies     | Unknown       | Try browser profile      |
 *
 * For providers where browser cookies don't work for automation:
 * - Use API tokens (OAuth, API keys)
 * - Export cookies from DevTools (may not work due to HttpOnly, Secure flags)
 * - Manual authentication via headful browser with user interaction
 */
export { ChromeProfileManager, getChromeProfileManager, detectChromeUserDataDir, detectChromeBinary, type ChromeProfileConfig, type BrowserProfile, } from "./chrome-profile-manager.js";
export { BaseBrowserScraper, type BrowserScraperConfig, type QuotaScrapingResult, } from "./base-browser-scraper.js";
export { CodexBrowserScraper, scrapeCodexQuota, type CodexQuotaData } from "./codex-browser-scraper.js";
export { ZaiBrowserScraper, scrapeZaiQuota, checkZaiCookies, type ZaiQuotaData } from "./zai-browser-scraper.js";
/**
 * All available browser scrapers
 */
export declare const BROWSER_SCRAPERS: {
    readonly "openai-codex": () => Promise<typeof import("./codex-browser-scraper.js").CodexBrowserScraper>;
    readonly "z-ai": () => Promise<typeof import("./zai-browser-scraper.js").ZaiBrowserScraper>;
};
export type BrowserScraperProvider = keyof typeof BROWSER_SCRAPERS;
