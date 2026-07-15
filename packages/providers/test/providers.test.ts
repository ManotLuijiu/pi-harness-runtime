/**
 * Providers Tests
 */

import { describe, it, expect } from "bun:test";
import {
	MiniMaxAdapter,
	OpenAIAdapter,
	ClaudeAdapter,
	AdapterRegistry,
} from "../src/adapters.js";
import type { ProviderConfig } from "../../../packages/types/src/runtime-types.js";

const makeConfig = (id: string): ProviderConfig => ({
	id,
	name: id,
	models: [`${id}/model-a`, `${id}/model-b`],
	capabilities: ["code", "review"],
	rateLimits: {},
});

describe("MiniMaxAdapter", () => {
	const adapter = new MiniMaxAdapter(makeConfig("minimax"));

	it("has correct id and name", () => {
		expect(adapter.id).toBe("minimax");
		expect(adapter.name).toBe("MiniMax");
	});

	it("supports its configured models", () => {
		expect(adapter.supportsModel("minimax/model-a")).toBe(true);
		expect(adapter.supportsModel("minimax/model-b")).toBe(true);
	});

	it("does not support other models", () => {
		expect(adapter.supportsModel("openai/gpt-4")).toBe(false);
	});

	it("returns default model", () => {
		expect(adapter.getDefaultModel()).toBe("minimax/model-a");
	});

	it("returns correct max tokens", () => {
		expect(adapter.getMaxTokens("minimax/MiniMax-Text-01")).toBe(1000000);
		expect(adapter.getMaxTokens("minimax/MiniMax-M3")).toBe(32768);
	});

	it("returns capabilities", () => {
		const caps = adapter.getCapabilities();
		expect(caps).toContain("code");
		expect(caps).toContain("review");
	});

	it("parses MiniMax quota errors", () => {
		const result = adapter.parseError({
			message: "Error code: 2056 - Rate limit exceeded",
		});
		expect(result.quotaExceeded).toBe(true);
		expect(result.rateLimited).toBe(true);
	});

	it("parses rate limit errors", () => {
		const result = adapter.parseError({
			message: "Rate limit exceeded, retry after 429",
		});
		expect(result.rateLimited).toBe(true);
	});

	it("parses timeout errors", () => {
		const result = adapter.parseError({ message: "Request timed out" });
		expect(result.timeout).toBe(true);
	});

	it("parses server errors", () => {
		const result = adapter.parseError({ message: "Internal server error 500" });
		expect(result.serverError).toBe(true);
	});

	it("parses client errors", () => {
		const result = adapter.parseError({ message: "Bad request 400" });
		expect(result.clientError).toBe(true);
	});

	it("invokes and returns mock result", async () => {
		const result = await adapter.invoke({
			model: "minimax/model-a",
			messages: [],
			maxTokens: 100,
		});
		expect(result.response.content).toBe("Mock response");
		expect(result.retryable).toBe(false);
	});
});

describe("OpenAIAdapter", () => {
	const adapter = new OpenAIAdapter(makeConfig("openai"));

	it("has correct id and name", () => {
		expect(adapter.id).toBe("openai");
		expect(adapter.name).toBe("OpenAI");
	});

	it("parses insufficient_quota error", () => {
		const result = adapter.parseError({
			code: "insufficient_quota",
			message: "Quota exceeded",
		});
		expect(result.quotaExceeded).toBe(true);
		expect(result.quotaSignal?.exhausted).toBe(true);
	});

	it("parses rate_limit_exceeded error", () => {
		const result = adapter.parseError({
			code: "rate_limit_exceeded",
			message: "Rate limit",
		});
		expect(result.rateLimited).toBe(true);
	});

	it("returns correct max tokens", () => {
		expect(adapter.getMaxTokens("openai/gpt-4o")).toBe(128000);
	});
});

describe("ClaudeAdapter", () => {
	const adapter = new ClaudeAdapter(makeConfig("anthropic"));

	it("has correct id and name", () => {
		expect(adapter.id).toBe("anthropic");
		expect(adapter.name).toBe("Anthropic Claude");
	});

	it("returns Claude default model", () => {
		expect(adapter.getDefaultModel()).toBe(
			"anthropic/claude-3-5-sonnet-20240620",
		);
	});

	it("returns large token limits for Claude models", () => {
		expect(adapter.getMaxTokens("anthropic/claude-3-5-sonnet-20240620")).toBe(
			200000,
		);
		expect(adapter.getMaxTokens("anthropic/claude-3-opus-20240229")).toBe(
			200000,
		);
		expect(adapter.getMaxTokens("anthropic/claude-2")).toBe(100000);
	});

	it("parses rate_limit_error type", () => {
		const result = adapter.parseError({
			type: "rate_limit_error",
			message: "Rate limited",
		});
		expect(result.rateLimited).toBe(true);
	});

	it("parses overloaded_error type", () => {
		const result = adapter.parseError({
			type: "overloaded_error",
			message: "Overloaded",
		});
		expect(result.rateLimited).toBe(true);
		expect(result.serverError).toBe(true);
	});

	it("parses quota_error type", () => {
		const result = adapter.parseError({
			type: "quota_error",
			message: "Quota exceeded",
		});
		expect(result.quotaExceeded).toBe(true);
		expect(result.quotaSignal?.exhausted).toBe(true);
	});

	it("parses authentication_error as client error", () => {
		const result = adapter.parseError({
			type: "authentication_error",
			message: "Auth failed",
		});
		expect(result.clientError).toBe(true);
	});
});

describe("AdapterRegistry", () => {
	it("starts empty", () => {
		const registry = new AdapterRegistry();
		expect(registry.list()).toEqual([]);
		expect(registry.get("minimax")).toBeUndefined();
	});

	it("registers and retrieves adapters", () => {
		const registry = new AdapterRegistry();
		const adapter = new MiniMaxAdapter(makeConfig("minimax"));
		registry.register(adapter);

		expect(registry.get("minimax")).toBe(adapter);
		expect(registry.list()).toHaveLength(1);
	});

	it("creates default registry with all adapters", () => {
		const registry = AdapterRegistry.createDefault();
		const adapters = registry.list();

		expect(adapters.some((a) => a.id === "minimax")).toBe(true);
		expect(adapters.some((a) => a.id === "openai")).toBe(true);
		expect(adapters.some((a) => a.id === "anthropic")).toBe(true);
		expect(registry.get("minimax")).toBeDefined();
		expect(registry.get("openai")).toBeDefined();
		expect(registry.get("anthropic")).toBeDefined();
	});

	it("overwrites adapter with same id", () => {
		const registry = new AdapterRegistry();
		const a1 = new MiniMaxAdapter(makeConfig("minimax"));
		const a2 = new MiniMaxAdapter({
			...makeConfig("minimax"),
			name: "New MinMax",
		});
		registry.register(a1);
		registry.register(a2);

		expect(registry.list()).toHaveLength(1);
		expect(registry.get("minimax")).toBe(a2);
	});
});
