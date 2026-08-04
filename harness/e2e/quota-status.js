/**
 * Quota Status Display — RFC-0031
 *
 * Integrates MiniMax quota scraper with harness status display.
 * Provides real-time quota data for the status bar.
 */
import { MiniMaxQuotaManager, } from "./minimax-quota-scraper.js";
/**
 * Format quota data for display
 */
export function formatQuotaStatus(data) {
    const h5Left = Math.max(0, 100 - data.h5UsedPct);
    const weeklyLeft = Math.max(0, 100 - data.weeklyUsedPct);
    const short = `5h: ${h5Left.toFixed(0)}% left`;
    const extendedParts = [short, `week: ${weeklyLeft.toFixed(0)}% left`];
    return {
        short,
        extended: extendedParts.join(" · "),
        isCritical: h5Left < 20,
        isExhausted: h5Left <= 0,
        h5ResetsAt: data.h5ResetsAt,
        weeklyResetsAt: data.weeklyResetsAt,
        data,
    };
}
/**
 * Quota Status Manager
 *
 * Manages quota display with automatic refresh.
 */
export class QuotaStatusManager {
    manager;
    lastStatus;
    refreshTimer;
    config;
    constructor(config) {
        this.config = {
            refreshIntervalMs: 5 * 60 * 1000, // 5 min default
            ...config,
        };
        if (config.provider === "minimax") {
            this.manager = new MiniMaxQuotaManager({
                cookieFile: config.cookieFile,
                cacheDurationMs: config.refreshIntervalMs,
            });
        }
    }
    /**
     * Check if quota tracking is available
     */
    isAvailable() {
        if (this.config.provider === "minimax") {
            return this.manager?.isAvailable() ?? false;
        }
        return false;
    }
    /**
     * Get current quota status (async refresh if needed)
     */
    async getStatus(forceRefresh = false) {
        if (!this.manager) {
            return null;
        }
        try {
            const data = await this.manager.getQuota(forceRefresh);
            this.lastStatus = this.config.formatter
                ? this.config.formatter(data)
                : formatQuotaStatus(data);
            return this.lastStatus;
        }
        catch (error) {
            console.warn("[QuotaStatus] Failed to fetch quota:", error);
            return this.lastStatus ?? null;
        }
    }
    /**
     * Get last cached status (synchronous)
     */
    getCachedStatus() {
        return this.lastStatus ?? null;
    }
    /**
     * Start automatic refresh
     */
    startAutoRefresh(callback) {
        if (this.refreshTimer) {
            return; // Already running
        }
        // Initial fetch
        this.getStatus().then((status) => {
            if (status && callback) {
                callback(status);
            }
        });
        // Periodic refresh
        this.refreshTimer = setInterval(async () => {
            const status = await this.getStatus();
            if (status && callback) {
                callback(status);
            }
        }, this.config.refreshIntervalMs);
    }
    /**
     * Stop automatic refresh
     */
    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }
    /**
     * Generate status bar string
     */
    async getStatusBarString() {
        const status = await this.getStatus();
        if (!status) {
            return `${this.config.provider}: no quota data`;
        }
        const icon = status.isExhausted ? "🚫" : status.isCritical ? "⚠️" : "✅";
        return `${icon} ${this.config.provider} ${status.extended}`;
    }
}
/**
 * Create a quota status manager from environment variables
 */
export function createQuotaStatusManagerFromEnv(provider = process.env.QUOTA_PROVIDER ?? "minimax") {
    // Check if quota tracking is enabled
    if (process.env.QUOTA_AUTO_FETCH !== "true") {
        return null;
    }
    // Check if cookie file exists
    const cookieFile = process.env.QUOTA_COOKIE_FILE ??
        `${process.env.HOME ?? process.env.USERPROFILE}/.config/minimax-cookies.txt`;
    return new QuotaStatusManager({
        provider,
        cookieFile,
        refreshIntervalMs: parseInt(process.env.QUOTA_REFRESH_MS ?? "300000", 10),
    });
}
