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

// Chrome profile management for persistent sessions
export {
	ChromeProfileManager,
	getChromeProfileManager,
	detectChromeUserDataDir,
	detectChromeBinary,
	type ChromeProfileConfig,
	type BrowserProfile,
} from "./chrome-profile-manager.js";

// Base scraper class
export {
	BaseBrowserScraper,
	type BrowserScraperConfig,
	type QuotaScrapingResult,
} from "./base-browser-scraper.js";

// Provider-specific scrapers
export { CodexBrowserScraper, scrapeCodexQuota, type CodexQuotaData } from "./codex-browser-scraper.js";
export { ZaiBrowserScraper, scrapeZaiQuota, checkZaiCookies, type ZaiQuotaData } from "./zai-browser-scraper.js";

/**
 * All available browser scrapers
 */
export const BROWSER_SCRAPERS = {
	"openai-codex": () => import("./codex-browser-scraper.js").then((m) => m.CodexBrowserScraper),
	"z-ai": () => import("./zai-browser-scraper.js").then((m) => m.ZaiBrowserScraper),
} as const;

export type BrowserScraperProvider = keyof typeof BROWSER_SCRAPERS;
