/**
 * TUI Usage Integration Example
 *
 * Shows how to integrate TUIUsageMonitor with the pi extension.
 *
 * Usage:
 * ```typescript
 * import { QuotaManager, TUIUsageMonitor } from "@pi-harness/quota-manager";
 *
 * // In your extension setup:
 * const quotaManager = new QuotaManager();
 *
 * const monitor = new TUIUsageMonitor({
 *   quotaManager,
 *   debug: true,
 * });
 *
 * // Hook into pi events
 * pi.on("error", (event) => {
 *   monitor.processMessage(event.message);
 * });
 *
 * pi.on("message", (event) => {
 *   monitor.processMessage(event.message);
 * });
 *
 * // Now QuotaManager automatically receives signals from all providers
 * // Check provider availability:
 * if (!quotaManager.isAvailable("openai")) {
 *   console.log("OpenAI exhausted, waiting for:", quotaManager.getWaitTime("openai"));
 * }
 * ```
 */
export {};
//# sourceMappingURL=tui-usage-integration.d.ts.map