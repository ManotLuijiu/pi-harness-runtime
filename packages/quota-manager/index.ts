/**
 * Quota Manager Package
 *
 * Collects quota signals from multiple sources:
 * - API responses
 * - Provider status
 * - Playwright scraping
 * - TUI messages
 * - Local estimates
 */

// Core Quota Manager
export {
	QuotaManager,
	parseMiniMaxError,
	parseOpenAIError,
} from "./quota-manager.js";
export type { QuotaSignalInput } from "./quota-manager.js";

// TUI Usage Monitor (unified message parser)
export {
	TUIUsageMonitor,
	createTUIUsageMonitor,
} from "./tui-usage-monitor.js";
export type {
	TUIUsageSignal,
	TUIUsageMonitorConfig,
} from "./tui-usage-monitor.js";
