/**
 * Context Manager Tests (RFC-0010)
 */

import { describe, it, expect } from "bun:test";
import {
	DEFAULT_POLICY,
	estimatePressure,
	getPressureLevel,
	createSessionScope,
	setTTL,
	addToScope,
	evictExpired,
	prioritize,
	estimateTokens,
	calculateTotalTokens,
	compactContext,
	generateResumePrompt,
	formatResumeMarkdown,
} from "../src/index.js";

const makeItem = (
	overrides?: Partial<import("../src/index.js").ContextItem>,
): import("../src/index.js").ContextItem => ({
	id: `item-${Math.random().toString(36).slice(2)}`,
	role: "user",
	content: "Test content",
	tokens: 10,
	priority: 5,
	timestamp: Date.now(),
	...overrides,
});

describe("DEFAULT_POLICY", () => {
	it("has threshold values", () => {
		expect(DEFAULT_POLICY.warningThreshold).toBe(0.6);
		expect(DEFAULT_POLICY.compactThreshold).toBe(0.7);
		expect(DEFAULT_POLICY.hardStopThreshold).toBe(0.85);
	});
});

describe("estimatePressure", () => {
	it("returns ratio", () => expect(estimatePressure(5000, 10000)).toBe(0.5));
	it("caps at 1", () => expect(estimatePressure(15000, 10000)).toBe(1));
	it("handles zero max", () => expect(estimatePressure(100, 0)).toBe(1));
});

describe("getPressureLevel", () => {
	it("normal below warning", () =>
		expect(getPressureLevel(0.3)).toBe("normal"));
	it("warning above warningThreshold", () =>
		expect(getPressureLevel(0.65)).toBe("warning"));
	it("compact above compactThreshold", () =>
		expect(getPressureLevel(0.75)).toBe("compact"));
	it("hard_stop above hardStopThreshold", () =>
		expect(getPressureLevel(0.9)).toBe("hard_stop"));
	it("uses custom policy", () => {
		const custom = {
			warningThreshold: 0.1,
			compactThreshold: 0.2,
			hardStopThreshold: 0.3,
		};
		expect(getPressureLevel(0.25, custom)).toBe("compact");
	});
});

describe("createSessionScope", () => {
	it("creates with defaults", () => {
		const scope = createSessionScope("session-1");
		expect(scope.id).toBe("session-1");
		expect(scope.items).toEqual([]);
		expect(scope.ttlMs).toBe(30 * 60 * 1000);
		expect(scope.createdAt).toBeGreaterThan(0);
	});
});

describe("setTTL", () => {
	it("updates ttl", () => {
		const scope = createSessionScope("s1");
		const updated = setTTL(scope, 60_000);
		expect(updated.ttlMs).toBe(60_000);
		expect(updated.id).toBe("s1");
	});
});

describe("addToScope", () => {
	it("appends item", () => {
		const scope = createSessionScope("s1");
		const item = makeItem({ id: "i1" });
		const updated = addToScope(scope, item);
		expect(updated.items).toHaveLength(1);
		expect(updated.items[0].id).toBe("i1");
	});
});

describe("evictExpired", () => {
	it("removes expired items", () => {
		const scope = createSessionScope("s1");
		const item1 = makeItem({ id: "i1", expiresAt: Date.now() + 10000 });
		const item2 = makeItem({ id: "i2", expiresAt: Date.now() - 1000 });
		const updated = addToScope(addToScope(scope, item1), item2);
		const evicted = evictExpired(updated);
		expect(evicted.items.map((i) => i.id)).toEqual(["i1"]);
	});

	it("keeps items without expiry", () => {
		const scope = createSessionScope("s1");
		const item = makeItem({ id: "i1" });
		const updated = addToScope(scope, item);
		expect(evictExpired(updated).items).toHaveLength(1);
	});
});

describe("prioritize", () => {
	it("sorts by priority ascending", () => {
		const items = [
			makeItem({ id: "low", priority: 9 }),
			makeItem({ id: "high", priority: 1 }),
			makeItem({ id: "mid", priority: 5 }),
		];
		const sorted = prioritize(items);
		expect(sorted.map((i) => i.id)).toEqual(["high", "mid", "low"]);
	});

	it("respects limit", () => {
		const items = [
			makeItem({ id: "a", priority: 3 }),
			makeItem({ id: "b", priority: 1 }),
			makeItem({ id: "c", priority: 2 }),
		];
		expect(prioritize(items, 2)).toHaveLength(2);
	});
});

describe("estimateTokens", () => {
	it("counts chars/4", () => expect(estimateTokens("abcdefgh")).toBe(2));
	it("rounds up", () => expect(estimateTokens("abc")).toBe(1));
});

describe("calculateTotalTokens", () => {
	it("sums tokens", () => {
		const items = [makeItem({ tokens: 10 }), makeItem({ tokens: 20 })];
		expect(calculateTotalTokens(items)).toBe(30);
	});
	it("empty returns 0", () => expect(calculateTotalTokens([])).toBe(0));
});

describe("compactContext", () => {
	it("extracts decisions", () => {
		const items = [makeItem({ content: "DECISION: use tRPC for API" })];
		const result = compactContext(items, 1000);
		expect(result.decisions.length).toBeGreaterThan(0);
	});

	it("extracts questions", () => {
		const items = [
			makeItem({
				content: "Should we use Redis? TODO: decide caching strategy",
			}),
		];
		const result = compactContext(items, 1000);
		expect(result.openQuestions.length).toBeGreaterThan(0);
	});

	it("respects maxTokens threshold", () => {
		const items = [makeItem({ tokens: 100 })];
		const result = compactContext(items, 50);
		expect(result.remainingTokens).toBeLessThan(100);
	});
});

describe("generateResumePrompt", () => {
	it("creates prompt from result", () => {
		const result = compactContext([], 1000);
		const prompt = generateResumePrompt(result, "Continue with API");
		expect(prompt.nextAction).toBe("Continue with API");
		expect(prompt.decisions).toEqual([]);
	});
});

describe("formatResumeMarkdown", () => {
	it("includes headings", () => {
		const prompt = generateResumePrompt(
			{
				decisions: ["Use tRPC"],
				openQuestions: ["Which DB?"],
				taskProgress: {},
				remainingTokens: 100,
				compactedContent: "",
			},
			"Continue",
		);
		const md = formatResumeMarkdown(prompt);
		expect(md).toContain("# Resume Prompt");
		expect(md).toContain("## Decisions");
		expect(md).toContain("## Next Action");
	});
});
