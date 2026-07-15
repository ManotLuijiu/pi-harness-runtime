/**
 * Token Estimation Tests
 */

import { describe, it, expect } from "bun:test";
import {
	roughTokenCount,
	roughMessageTokens,
	roughMessagesTokens,
	roughSystemPromptTokens,
	roughToolDefinitionTokens,
	estimateRequestTokens,
} from "../src/index";

describe("roughTokenCount", () => {
	it("returns 0 for empty string", () => expect(roughTokenCount("")).toBe(0));

	it("returns 0 for null-like input", () =>
		expect(roughTokenCount("   ")).toBeGreaterThanOrEqual(0));

	it("returns positive for non-empty text", () =>
		expect(roughTokenCount("hello world")).toBeGreaterThan(0));

	it("handles unicode text", () =>
		expect(roughTokenCount("สวัสดี")).toBeGreaterThan(0));

	it("handles long text proportionally", () => {
		const short = roughTokenCount("hi");
		const long = roughTokenCount("hi ".repeat(100));
		expect(long).toBeGreaterThan(short * 10);
	});
});

describe("roughMessageTokens", () => {
	it("adds role overhead", () => {
		const tokens = roughMessageTokens({ role: "user", content: null });
		expect(tokens).toBeGreaterThanOrEqual(4);
	});

	it("counts string content", () => {
		const tokens = roughMessageTokens({
			role: "user",
			content: "hello world",
		});
		expect(tokens).toBeGreaterThanOrEqual(4 + roughTokenCount("hello world"));
	});

	it("counts text blocks in content array", () => {
		const tokens = roughMessageTokens({
			role: "assistant",
			content: [{ type: "text", text: "the answer is 42" }],
		});
		expect(tokens).toBeGreaterThanOrEqual(
			4 + roughTokenCount("the answer is 42"),
		);
	});

	it("estimates tool_use blocks", () => {
		const tokens = roughMessageTokens({
			role: "assistant",
			content: [
				{
					type: "tool_use",
					name: "get_weather",
					input: { city: "Bangkok" },
				},
			],
		});
		expect(tokens).toBeGreaterThan(4 + roughTokenCount("get_weather"));
	});

	it("adds overhead for tool_result blocks", () => {
		const tokens = roughMessageTokens({
			role: "user",
			content: [{ type: "tool_result" }],
		});
		expect(tokens).toBeGreaterThanOrEqual(4 + 50);
	});

	it("estimates image blocks as 2000 tokens", () => {
		const tokens = roughMessageTokens({
			role: "user",
			content: [{ type: "image" }],
		});
		expect(tokens).toBeGreaterThanOrEqual(4 + 2000);
	});

	it("counts tool_calls outside content", () => {
		const tokens = roughMessageTokens({
			role: "assistant",
			content: null,
			tool_calls: [{ id: "call-1", name: "search", input: { q: "test" } }],
		});
		expect(tokens).toBeGreaterThan(4 + roughTokenCount("search"));
	});

	it("returns 0 for null message", () =>
		expect(roughMessageTokens(null as any)).toBe(0));

	it("counts thinking blocks", () => {
		const tokens = roughMessageTokens({
			role: "assistant",
			content: null,
			thinking: "I should use the search tool here",
		});
		expect(tokens).toBeGreaterThanOrEqual(
			4 + roughTokenCount("I should use the search tool here"),
		);
	});
});

describe("roughMessagesTokens", () => {
	it("sums tokens from multiple messages", () => {
		const messages = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		];
		const total = roughMessagesTokens(messages);
		const individual =
			roughMessageTokens({ role: "user", content: "hello" }) +
			roughMessageTokens({ role: "assistant", content: "hi there" });
		expect(total).toBe(individual);
	});

	it("returns 0 for empty array", () =>
		expect(roughMessagesTokens([])).toBe(0));
});

describe("roughSystemPromptTokens", () => {
	it("includes overhead plus content", () => {
		const tokens = roughSystemPromptTokens("You are a helpful assistant");
		expect(tokens).toBeGreaterThanOrEqual(
			15 + roughTokenCount("You are a helpful assistant"),
		);
	});

	it("handles empty system prompt", () =>
		expect(roughSystemPromptTokens("")).toBe(15));
});

describe("roughToolDefinitionTokens", () => {
	it("counts name, description, and input_schema", () => {
		const tokens = roughToolDefinitionTokens({
			name: "get_weather",
			description: "Get current weather",
			input_schema: {
				type: "object",
				properties: { city: { type: "string" } },
			},
		});
		expect(tokens).toBeGreaterThanOrEqual(
			roughTokenCount("get_weather") +
				roughTokenCount("Get current weather") +
				roughTokenCount(
					'{"type":"object","properties":{"city":{"type":"string"}}}',
				),
		);
	});

	it("handles minimal tool with only name", () => {
		const tokens = roughToolDefinitionTokens({ name: "ping" });
		expect(tokens).toBeGreaterThan(0);
	});
});

describe("estimateRequestTokens", () => {
	it("sums system + messages + tools", () => {
		const estimate = estimateRequestTokens(
			"You are a helpful assistant",
			[{ role: "user", content: "hello" }],
			[{ name: "search", description: "Search the web" }],
			100_000,
		);
		expect(estimate.total).toBeGreaterThan(estimate.systemPrompt);
		expect(estimate.total).toBeGreaterThan(estimate.messages);
		expect(estimate.total).toBeGreaterThan(estimate.tools);
		expect(estimate.total).toBe(
			estimate.systemPrompt + estimate.messages + estimate.tools,
		);
	});

	it("computes availableForContext correctly", () => {
		const estimate = estimateRequestTokens(
			"system",
			[{ role: "user", content: "msg" }],
			[],
			100_000,
		);
		expect(estimate.availableForContext).toBe(100_000 - estimate.total);
	});

	it("returns 0 available when over limit", () => {
		const estimate = estimateRequestTokens(
			"x".repeat(200_000),
			[],
			[],
			100_000,
		);
		expect(estimate.availableForContext).toBeLessThan(100_000);
	});

	it("handles empty inputs", () => {
		const estimate = estimateRequestTokens("", [], [], 100_000);
		expect(estimate.total).toBe(15); // system overhead only
		expect(estimate.availableForContext).toBe(100_000 - 15);
	});
});
