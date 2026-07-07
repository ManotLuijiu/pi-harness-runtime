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

// Example standalone usage
/*
import { QuotaManager, TUIUsageMonitor } from "./index.js";

// Create quota manager
const quotaManager = new QuotaManager();

// Create TUI monitor
const monitor = new TUIUsageMonitor({
	quotaManager,
	debug: true,
});

// Process some example messages
const messages = [
	"OpenAI: Quota exhausted. Reset at 14:30",
	"GLM context window full. Retry in 30 minutes",
	"Anthropic Claude rate limit hit. 429 error",
	"OpenRouter tokens running out",
];

for (const msg of messages) {
	const signal = monitor.processMessage(msg);
	if (signal) {
		console.log(`Detected: ${signal.provider} - ${signal.limitType}`);
		console.log(`  Exhausted: ${signal.exhausted}`);
		console.log(`  Resets at: ${signal.resetsAt}`);
		console.log("");
	}
}

// Check quota state
console.log("=== Quota State ===");
for (const provider of ["openai", "glm", "anthropic", "openrouter"]) {
	const state = quotaManager.getProviderState(provider);
	console.log(`${provider}: ${state.exhausted ? "EXHAUSTED" : state.limited ? "LIMITED" : "AVAILABLE"}`);
}
*/
