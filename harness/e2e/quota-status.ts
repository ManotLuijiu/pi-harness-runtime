/**
 * Quota Status Display — RFC-0031
 *
 * Integrates MiniMax quota scraper with harness status display.
 * Provides real-time quota data for the status bar.
 */

import {
	MiniMaxQuotaScraper,
	MiniMaxQuotaManager,
	type MiniMaxQuotaData,
} from "./minimax-quota-scraper.js";

export interface QuotaStatus {
	/** Short status for display (e.g., "5h: 100% left") */
	short: string;
	/** Extended status (e.g., "5h: 100% left · week: 26% left") */
	extended: string;
	/** Whether quota is critical (< 20%) */
	isCritical: boolean;
	/** Whether quota is exhausted */
	isExhausted: boolean;
	/** Reset time for 5h window */
	h5ResetsAt?: string;
	/** Reset time for weekly window */
	weeklyResetsAt?: string;
	/** Raw data source */
	data?: MiniMaxQuotaData;
}

export interface QuotaDisplayConfig {
	/** Provider name */
	provider: string;
	/** Cookie file path */
	cookieFile?: string;
	/** Refresh interval in ms (default: 5 min) */
	refreshIntervalMs?: number;
	/** Custom formatter */
	formatter?: (data: MiniMaxQuotaData) => QuotaStatus;
}

/**
 * Format quota data for display
 */
export function formatQuotaStatus(data: MiniMaxQuotaData): QuotaStatus {
	const h5Left = Math.max(0, 100 - data.h5UsedPct);
	const weeklyLeft = Math.max(0, 100 - data.weeklyUsedPct);

	const short = `5h: ${h5Left.toFixed(0)}% left`;
	const extendedParts = [short];

	if (data.weeklyUsedPct > 0) {
		extendedParts.push(`week: ${weeklyLeft.toFixed(0)}% left`);
	}

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
	private manager?: MiniMaxQuotaManager;
	private lastStatus?: QuotaStatus;
	private refreshTimer?: ReturnType<typeof setInterval>;
	private readonly config: QuotaDisplayConfig;

	constructor(config: QuotaDisplayConfig) {
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
	isAvailable(): boolean {
		if (this.config.provider === "minimax") {
			return this.manager?.isAvailable() ?? false;
		}
		return false;
	}

	/**
	 * Get current quota status (async refresh if needed)
	 */
	async getStatus(forceRefresh = false): Promise<QuotaStatus | null> {
		if (!this.manager) {
			return null;
		}

		try {
			const data = await this.manager.getQuota(forceRefresh);
			this.lastStatus = this.config.formatter
				? this.config.formatter(data)
				: formatQuotaStatus(data);
			return this.lastStatus;
		} catch (error) {
			console.warn("[QuotaStatus] Failed to fetch quota:", error);
			return this.lastStatus ?? null;
		}
	}

	/**
	 * Get last cached status (synchronous)
	 */
	getCachedStatus(): QuotaStatus | null {
		return this.lastStatus ?? null;
	}

	/**
	 * Start automatic refresh
	 */
	startAutoRefresh(callback?: (status: QuotaStatus) => void): void {
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
		}, this.config.refreshIntervalMs!);
	}

	/**
	 * Stop automatic refresh
	 */
	stopAutoRefresh(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	/**
	 * Generate status bar string
	 */
	async getStatusBarString(): Promise<string> {
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
export function createQuotaStatusManagerFromEnv(
	provider = process.env.QUOTA_PROVIDER ?? "minimax",
): QuotaStatusManager | null {
	// Check if quota tracking is enabled
	if (process.env.QUOTA_AUTO_FETCH !== "true") {
		return null;
	}

	// Check if cookie file exists
	const cookieFile =
		process.env.QUOTA_COOKIE_FILE ??
		`${process.env.HOME ?? process.env.USERPROFILE}/.config/minimax-cookies.txt`;

	return new QuotaStatusManager({
		provider,
		cookieFile,
		refreshIntervalMs: parseInt(process.env.QUOTA_REFRESH_MS ?? "300000", 10),
	});
}
