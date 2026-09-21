/**
 * Codex Browser Scraper — Scrapes chatgpt.com/codex/cloud/settings/analytics
 *
 * Uses Playwright with Chrome profile to access the authenticated page
 * and extract usage/quota data.
 */
import { BaseBrowserScraper } from "./base-browser-scraper.js";
/**
 * Codex Browser Scraper
 *
 * Scrapes usage data from chatgpt.com/codex/cloud/settings/analytics
 */
export class CodexBrowserScraper extends BaseBrowserScraper {
    constructor(config = {}) {
        super({
            provider: "openai-codex",
            url: config.url ?? "https://chatgpt.com/codex/cloud/settings/analytics",
            headless: config.headless ?? true,
            timeout: config.timeout ?? 30000,
            viewport: config.viewport,
            slowMo: config.slowMo,
        });
    }
    async createBrowser() {
        const { chromium } = await import("playwright");
        const profileDir = this.getProfileDir();
        this.browser = await chromium.launch({
            headless: this.config.headless,
            slowMo: this.config.slowMo,
            args: [
                `--user-data-dir=${profileDir}`,
                "--disable-blink-features=AutomationControlled",
            ],
        });
        this.context = await this.browser.newContext({
            viewport: this.config.viewport,
        });
        this.page = await this.context.newPage();
    }
    getProfileDir() {
        const { join } = require("node:path");
        const { homedir } = require("node:os");
        return join(homedir(), ".pi-harness-runtime", "browser-profiles", "codex");
    }
    async isLoginPage() {
        if (!this.page)
            return false;
        // Check for common login indicators
        const loginSelectors = [
            'button[data-testid="sign-in"]',
            'button:has-text("Sign in")',
            'input[name="email"]',
            'input[placeholder*="email" i]',
            '[data-testid="login"]',
        ];
        for (const selector of loginSelectors) {
            try {
                const element = await this.page.$(selector);
                if (element != null) {
                    const text = await element.textContent();
                    if (text && /sign\s*in|log\s*in/i.test(text)) {
                        return true;
                    }
                }
            }
            catch {
                // Selector might not exist, continue
            }
        }
        // Check URL for login-related paths
        const url = this.page.url();
        if (/signin|login|auth/i.test(url)) {
            return true;
        }
        return false;
    }
    async extractData() {
        if (!this.page)
            return null;
        try {
            // Wait for the analytics page to load
            await this.page.waitForTimeout(3000);
            // Try multiple selectors for usage data
            const usageData = await this.extractUsageData();
            if (!usageData) {
                return null;
            }
            return {
                provider: "openai-codex",
                ...usageData,
                scrapedAt: new Date().toISOString(),
            };
        }
        catch (error) {
            console.error(`[codex] Extraction error: ${error}`);
            return null;
        }
    }
    async extractUsageData() {
        if (!this.page)
            return null;
        // Strategy 1: Look for percentage display
        const percentSelectors = [
            // Common patterns for usage percentage
            '[class*="usage"] [class*="percent"]',
            '[data-testid*="usage"] [class*="progress"]',
            '[class*="quota"] [class*="percent"]',
            // Text content patterns
            'text=/\\d+%/',
            // SVG progress circles
            'svg[class*="progress"]',
            // Heading patterns
            'h1:has-text("Usage") + *',
            'h2:has-text("Usage") + *',
        ];
        for (const selector of percentSelectors) {
            try {
                const element = await this.page.$(selector);
                if (element != null) {
                    const text = await element.textContent();
                    const percentMatch = text?.match(/(\d+(?:\.\d+)?)\s*%/);
                    if (percentMatch) {
                        const usagePercent = parseFloat(percentMatch[1]);
                        if (!isNaN(usagePercent)) {
                            // Try to get additional data
                            const additionalData = await this.extractAdditionalData();
                            return {
                                usagePercent,
                                ...additionalData,
                            };
                        }
                    }
                }
            }
            catch {
                // Continue to next selector
            }
        }
        // Strategy 2: Look for numbers in heading/title
        const headingData = await this.extractFromHeadings();
        if (headingData) {
            return headingData;
        }
        // Strategy 3: Look for chart/graph data (often contains raw numbers)
        const chartData = await this.extractChartData();
        if (chartData) {
            return chartData;
        }
        return null;
    }
    async extractAdditionalData() {
        const result = {};
        // Try to extract plan type
        const planSelectors = [
            '[class*="plan"]',
            '[data-testid*="plan"]',
            'text=/Pro|Plus|Team|Enterprise/i',
        ];
        for (const selector of planSelectors) {
            try {
                if (!this.page)
                    continue;
                const text = await this.page.locator(selector).first().textContent({ timeout: 2000 }).catch(() => null);
                if (text && /Pro|Plus|Team|Enterprise/i.test(text)) {
                    result.planType = text.trim();
                    break;
                }
            }
            catch {
                // Continue
            }
        }
        // Try to extract quota amounts (e.g., "1.5 GB of 5 GB used")
        const quotaText = await this.extractText('text=/\\d+.*\\/(?:of\\s+)?\\d+/');
        if (quotaText) {
            const match = quotaText.match(/([\d,.]+)\s*(?:GB|MB|TB)?\s*(?:\/|of)\s*([\d,.]+)\s*(?:GB|MB|TB)?/i);
            if (match) {
                result.usedQuota = match[1];
                result.totalQuota = match[2];
                result.remainingQuota = String(parseFloat(match[2]) - parseFloat(match[1]));
            }
        }
        // Try to extract reset date
        const resetSelectors = [
            'text=/resets?\\s+(at|on|in)/i',
            '[class*="reset"]',
            '[class*="renews"]',
        ];
        for (const selector of resetSelectors) {
            try {
                if (!this.page)
                    continue;
                const text = await this.page.locator(selector).first().textContent({ timeout: 2000 }).catch(() => null);
                if (text) {
                    result.resetAt = text.trim();
                    break;
                }
            }
            catch {
                // Continue
            }
        }
        return result;
    }
    async extractFromHeadings() {
        if (!this.page)
            return null;
        // Get all headings and look for ones containing numbers
        const headings = await this.page.$$("h1, h2, h3, h4");
        for (const heading of headings) {
            const text = await heading.textContent();
            if (text) {
                const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
                if (percentMatch) {
                    return {
                        usagePercent: parseFloat(percentMatch[1]),
                        period: text.replace(percentMatch[0], "").trim() || undefined,
                    };
                }
            }
        }
        return null;
    }
    async extractChartData() {
        if (!this.page)
            return null;
        // Look for canvas or SVG charts
        const charts = await this.page.$$("canvas, svg[class*='chart'], svg[class*='graph']");
        if (charts.length > 0) {
            // Try to get data from aria-labels or data attributes
            for (const chart of charts) {
                const ariaLabel = await chart.getAttribute("aria-label");
                if (ariaLabel) {
                    const percentMatch = ariaLabel.match(/(\d+(?:\.\d+)?)\s*%/);
                    if (percentMatch) {
                        return {
                            usagePercent: parseFloat(percentMatch[1]),
                        };
                    }
                }
            }
            // Try to extract from JavaScript data
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chartData = await this.page.evaluate(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const win = globalThis;
                const doc = win.document;
                if (!doc)
                    return null;
                const canvases = doc.querySelectorAll("canvas");
                const foundResult = null;
                for (const canvas of canvases) {
                    const parent = canvas.parentElement;
                    if (parent) {
                        const attrNames = Array.from(parent.getAttributeNames());
                        for (const attrName of attrNames) {
                            if (attrName.startsWith("data-") || attrName.includes("chart")) {
                                const value = parent.getAttribute(attrName);
                                const match = value?.match(/(\d+(?:\.\d+)?)\s*%/);
                                if (match) {
                                    return { percent: parseFloat(match[1]) };
                                }
                            }
                        }
                    }
                }
                return foundResult;
            });
            if (chartData?.percent) {
                return { usagePercent: chartData.percent };
            }
        }
        return null;
    }
}
/**
 * Quick scrape function
 */
export async function scrapeCodexQuota() {
    const scraper = new CodexBrowserScraper({ headless: true });
    try {
        const result = await scraper.scrape();
        return result.data ?? null;
    }
    finally {
        await scraper.cleanup();
    }
}
