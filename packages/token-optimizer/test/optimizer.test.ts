/**
 * Token Optimizer Tests (RFC-0011)
 */

import { describe, it, expect } from "bun:test";
import {
	estimateTokens,
	estimateMessageTokens,
	buildBudget,
	splitByPriority,
	optimizeBudget,
	calculateCost,
	trimToTokens,
	DEFAULT_PRICING,
} from "../src/index.js";
import type { PromptMessage } from "../src/index.js";

const makeMsg = (overrides?: Partial<PromptMessage>): PromptMessage => ({
	role: "user",
	content: "Hello world",
	priority: 5,
	...overrides,
});

describe("DEFAULT_PRICING", () => {
	it("has gpt-4o pricing", () => {
		expect(DEFAULT_PRICING["gpt-4o"].inputPer1M).toBe(2.5);
		expect(DEFAULT_PRICING["gpt-4o"].outputPer1M).toBe(10.0);
	});
	it("has claude pricing", () => {
		expect(DEFAULT_PRICING["claude-haiku"].inputPer1M).toBe(0.25);
	});
});

describe("estimateTokens", () => {
	it("estimates 1 token per 4 chars", () => {
		expect(estimateTokens("01234")).toBe(2);
	});
	it("empty string returns 0", () => expect(estimateTokens("")).toBe(0));
});

describe("estimateMessageTokens", () => {
	it("sums messages plus overhead", () => {
		const msgs = [makeMsg({ content: "hello" }), makeMsg({ content: "world" })];
		expect(estimateMessageTokens(msgs)).toBeGreaterThan(
			estimateTokens("hello") + estimateTokens("world"),
		);
	});
	it("empty returns 0", () => expect(estimateMessageTokens([])).toBe(0));
});

describe("buildBudget", () => {
	it("calculates available tokens", () => {
		const b = buildBudget(1000, 100, 50);
		expect(b.maxTokens).toBe(1000);
		expect(b.systemTokens).toBe(100);
		expect(b.reservedTokens).toBe(50);
		expect(b.availableTokens).toBe(850);
	});

	it("available never negative", () => {
		const b = buildBudget(100, 200, 0);
		expect(b.availableTokens).toBe(0);
	});
});

describe("splitByPriority", () => {
	it("splits into three groups", () => {
		const msgs = Array.from({ length: 9 }, (_, i) =>
			makeMsg({ content: `msg${i}`, priority: i + 1 }),
		);
		const { high, medium, low } = splitByPriority(msgs);
		expect(high.length).toBeGreaterThan(0);
		expect(medium.length).toBeGreaterThan(0);
		expect(low.length).toBeGreaterThan(0);
		expect(high[0].priority).toBeLessThanOrEqual(medium[0].priority);
	});

	it("handles single item", () => {
		const { high } = splitByPriority([makeMsg({ priority: 1 })]);
		expect(high.length).toBe(1);
	});
});

describe("optimizeBudget", () => {
	it("keeps high priority", () => {
		const msgs = [
			makeMsg({ content: "high", priority: 1 }),
			makeMsg({ content: "low", priority: 9 }),
		];
		const budget = buildBudget(1000, 0, 0);
		const result = optimizeBudget(msgs, budget);
		expect(result.kept.some((m) => m.content === "high")).toBe(true);
	});

	it("removes when over budget", () => {
		const longMsg = makeMsg({ content: "x".repeat(1000), priority: 5 });
		const budget = buildBudget(100, 0, 0);
		const result = optimizeBudget([longMsg], budget);
		expect(result.kept.length).toBeLessThan(1);
	});

	it("zero available keeps nothing", () => {
		const result = optimizeBudget([makeMsg()], buildBudget(100, 100, 0));
		expect(result.kept).toEqual([]);
		expect(result.compressionRatio).toBe(1);
	});
});

describe("calculateCost", () => {
	it("calculates total cost", () => {
		const msgs = [makeMsg({ content: "hello world" })];
		const cost = calculateCost(msgs, 50, "gpt-4o-mini");
		expect(cost.inputTokens).toBeGreaterThan(0);
		expect(cost.outputTokens).toBe(50);
		expect(cost.totalCost).toBeGreaterThan(0);
		expect(cost.currency).toBe("USD");
	});

	it("uses default pricing", () => {
		const cost = calculateCost([], 0, "unknown-model");
		expect(cost.totalCost).toBe(0);
	});
});

describe("trimToTokens", () => {
	it("trims to max tokens", () => {
		const text = "one two three four five";
		const trimmed = trimToTokens(text, 3);
		expect(trimmed.split(" ").length).toBeLessThanOrEqual(3);
	});

	it("returns empty for zero", () => {
		expect(trimToTokens("hello", 0)).toBe("");
	});

	it("handles text shorter than limit", () => {
		const result = trimToTokens("hi", 10);
		expect(result).toBe("hi");
	});
});
