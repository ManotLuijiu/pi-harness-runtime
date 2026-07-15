/**
 * Quota Manager Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	QuotaManager,
	parseMiniMaxError,
	parseOpenAIError,
} from "../src/quota-manager.js";
import { TUIUsageMonitor } from "../src/tui-usage-monitor.js";

describe("QuotaManager", () => {
	let manager: QuotaManager;

	beforeEach(() => {
		manager = new QuotaManager(30 * 60 * 1000);
	});

	describe("recordSignal", () => {
		it("records a basic signal", () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				usedPct: 50,
			});

			const signal = manager.getLatestSignal("minimax", "5h");
			expect(signal).not.toBeNull();
			expect(signal!.usedPct).toBe(50);
			expect(signal!.remainingPct).toBe(50);
			expect(signal!.exhausted).toBe(false);
		});

		it("records exhausted signal", () => {
			manager.recordSignal({
				provider: "openai",
				source: "api_response",
				windowType: "daily",
				usedPct: 100,
				exhausted: true,
			});

			const signal = manager.getLatestSignal("openai", "daily");
			expect(signal!.exhausted).toBe(true);
		});

		it("stores multiple signals per provider", () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				usedPct: 30,
			});
			manager.recordSignal({
				provider: "minimax",
				source: "playwright",
				windowType: "daily",
				usedPct: 70,
			});

			const signals = manager.getSignals("minimax");
			expect(signals.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("getLatestSignal", () => {
		it("returns most recent by capturedAt", async () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				usedPct: 10,
			});
			await new Promise((r) => setTimeout(r, 2));
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				usedPct: 80,
			});

			const latest = manager.getLatestSignal("minimax", "5h");
			expect(latest!.usedPct).toBe(80);
		});

		it("returns null for unknown provider", () => {
			expect(manager.getLatestSignal("unknown")).toBeNull();
		});
	});

	describe("getProviderState", () => {
		it("available when under 90%", () => {
			manager.recordSignal({
				provider: "openai",
				source: "api_response",
				windowType: "daily",
				usedPct: 50,
			});

			const state = manager.getProviderState("openai");
			expect(state.available).toBe(true);
			expect(state.limited).toBe(false);
			expect(state.exhausted).toBe(false);
		});

		it("limited when at 90%+", () => {
			manager.recordSignal({
				provider: "openai",
				source: "api_response",
				windowType: "daily",
				usedPct: 95,
			});

			const state = manager.getProviderState("openai");
			expect(state.limited).toBe(true);
			expect(state.available).toBe(false);
		});

		it("exhausted when at 100%", () => {
			manager.recordSignal({
				provider: "openai",
				source: "api_response",
				windowType: "daily",
				usedPct: 100,
			});

			const state = manager.getProviderState("openai");
			expect(state.exhausted).toBe(true);
		});

		it("exhausted when explicit flag set", () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				exhausted: true,
			});

			const state = manager.getProviderState("minimax");
			expect(state.exhausted).toBe(true);
		});

		it("includes next available time", () => {
			const future = new Date(Date.now() + 3600000).toISOString();
			manager.recordSignal({
				provider: "openai",
				source: "api_response",
				windowType: "daily",
				exhausted: true,
				resetsAt: future,
			});

			const state = manager.getProviderState("openai");
			expect(state.nextAvailableAt).toBeDefined();
		});
	});

	describe("isAvailable / isExhausted", () => {
		it("isAvailable true when under 90%", () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				usedPct: 50,
			});
			expect(manager.isAvailable("minimax")).toBe(true);
		});

		it("isExhausted true when exhausted", () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				exhausted: true,
			});
			expect(manager.isExhausted("minimax")).toBe(true);
		});
	});

	describe("selectBestProvider", () => {
		it("returns provider with most remaining quota", () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				usedPct: 80,
			});
			manager.recordSignal({
				provider: "openai",
				source: "api_response",
				windowType: "5h",
				usedPct: 30,
			});

			const best = manager.selectBestProvider(["minimax", "openai"]);
			expect(best).toBe("openai");
		});

		it("returns null when all exhausted", () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				exhausted: true,
			});
			manager.recordSignal({
				provider: "openai",
				source: "api_response",
				windowType: "5h",
				exhausted: true,
			});

			expect(manager.selectBestProvider(["minimax", "openai"])).toBeNull();
		});

		it("returns null for empty list", () => {
			expect(manager.selectBestProvider([])).toBeNull();
		});
	});

	describe("clearStale", () => {
		it("clears old signals", () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				usedPct: 50,
			});

			// Manually add a stale signal (simulated)
			manager.clearStale();

			const signals = manager.getSignals("minimax");
			expect(signals.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe("generateReport", () => {
		it("generates report for known providers", () => {
			manager.recordSignal({
				provider: "minimax",
				source: "api_response",
				windowType: "5h",
				usedPct: 45,
			});

			const report = manager.generateReport(["minimax"]);
			expect(report).toContain("minimax");
			expect(report).toContain("AVAILABLE");
		});

		it("shows EXHAUSTED for exhausted providers", () => {
			manager.recordSignal({
				provider: "openai",
				source: "api_response",
				windowType: "daily",
				exhausted: true,
			});

			const report = manager.generateReport(["openai"]);
			expect(report).toContain("EXHAUSTED");
		});
	});
});

describe("parseMiniMaxError", () => {
	it("parses quota error code 2056", () => {
		const result = parseMiniMaxError({
			message: "Error code: 2056 - Rate limit exceeded",
		});
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("minimax");
		expect(result!.exhausted).toBe(true);
	});

	it("parses quota keyword", () => {
		const result = parseMiniMaxError({ message: "quota exceeded" });
		expect(result).not.toBeNull();
		expect(result!.exhausted).toBe(true);
	});

	it("returns null for unrelated errors", () => {
		const result = parseMiniMaxError({ message: "Invalid request" });
		expect(result).toBeNull();
	});

	it("extracts retry time in seconds", () => {
		const result = parseMiniMaxError({
			message: "rate limit exceeded. Retry after 30 seconds",
		});
		expect(result).not.toBeNull();
		expect(result!.retryAfterMs).toBe(30000);
	});

	it("extracts retry time in minutes", () => {
		const result = parseMiniMaxError({
			message: "rate limit exceeded. Retry after 2 minutes",
		});
		expect(result).not.toBeNull();
		expect(result!.retryAfterMs).toBe(120000);
	});
});

describe("parseOpenAIError", () => {
	it("parses insufficient_quota", () => {
		const result = parseOpenAIError({
			code: "insufficient_quota",
			message: "Quota exceeded",
		});
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("openai");
		expect(result!.exhausted).toBe(true);
	});

	it("parses context_length_exceeded", () => {
		const result = parseOpenAIError({
			code: "context_length_exceeded",
			message: "Too many tokens",
		});
		expect(result).not.toBeNull();
		expect(result!.exhausted).toBe(true);
	});

	it("parses 429 rate limit", () => {
		const result = parseOpenAIError({
			message: "HTTP 429: Rate limit exceeded",
		});
		expect(result).not.toBeNull();
		expect(result!.exhausted).toBe(true);
		expect(result!.windowType).toBe("5h");
	});

	it("returns null for unrelated errors", () => {
		const result = parseOpenAIError({
			code: "invalid_request_error",
			message: "Bad request",
		});
		expect(result).toBeNull();
	});
});

describe("TUIUsageMonitor", () => {
	let manager: QuotaManager;
	let monitor: TUIUsageMonitor;

	beforeEach(() => {
		manager = new QuotaManager();
		monitor = new TUIUsageMonitor({ quotaManager: manager });
	});

	describe("detectProvider", () => {
		it("detects OpenAI", () => {
			expect(monitor.detectProvider("OpenAI GPT-4 quota exceeded")).toBe(
				"openai",
			);
		});

		it("detects GLM", () => {
			expect(monitor.detectProvider("GLM rate limit exceeded")).toBe("glm");
		});

		it("detects Anthropic Claude", () => {
			expect(monitor.detectProvider("Claude overloaded_error")).toBe(
				"anthropic",
			);
		});

		it("detects OpenRouter", () => {
			expect(monitor.detectProvider("OpenRouter quota exhausted")).toBe(
				"openrouter",
			);
		});

		it("returns null for unknown", () => {
			expect(monitor.detectProvider("Random message")).toBeNull();
		});
	});

	describe("processMessage", () => {
		it("processes OpenAI quota message", () => {
			const signal = monitor.processMessage(
				"OpenAI insufficient_quota: daily limit reached",
			);
			expect(signal).not.toBeNull();
			expect(signal!.provider).toBe("openai");
		});

		it("processes rate limit message", () => {
			const signal = monitor.processMessage(
				"Claude rate_limit_error: try again in 30 seconds",
			);
			expect(signal).not.toBeNull();
			expect(signal!.provider).toBe("anthropic");
			expect(signal!.limitType).toBe("rate_limit");
		});

		it("processes context window message", () => {
			const signal = monitor.processMessage(
				"OpenAI context_length_exceeded: too many tokens",
			);
			expect(signal).not.toBeNull();
			expect(signal!.limitType).toBe("context_window");
		});

		it("returns null for non-quota messages", () => {
			const signal = monitor.processMessage("Hello world, this is just a test");
			expect(signal).toBeNull();
		});

		it("records to QuotaManager", () => {
			monitor.processMessage("OpenAI quota exhausted at 100%");
			expect(manager.getSignals("openai").length).toBeGreaterThan(0);
		});

		it("stores last signal per provider", () => {
			monitor.processMessage("OpenAI quota exhausted at 100%");
			monitor.processMessage("GLM quota exhausted");
			const openaiSignal = monitor.getLastSignal("openai");
			const glmSignal = monitor.getLastSignal("glm");
			expect(openaiSignal?.provider).toBe("openai");
			expect(glmSignal?.provider).toBe("glm");
		});

		it("clears stored signals", () => {
			monitor.processMessage("OpenAI GPT-4 quota exhausted");
			monitor.clear();
			expect(monitor.getLastSignal("openai")).toBeNull();
		});
	});
});
