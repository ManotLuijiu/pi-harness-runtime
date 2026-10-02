/**
 * Unit tests for Codex session watcher
 *
 * Run with: bun test packages/codex-watcher/test/watch.test.ts
 */

// @ts-expect-error: bun:test types are provided by bun runtime
import { describe, expect, it } from "bun:test";
import { classifyMessage, parseNewMessages } from "../src/parser.js";

// ---------------------------------------------------------------------------
// Parser: parseNewMessages
// ---------------------------------------------------------------------------

describe("parseNewMessages", () => {
	it("returns empty array for empty input", () => {
		expect(parseNewMessages([], 0)).toEqual([]);
	});

	it("skips lines with ordinal ≤ fromOrdinal", () => {
		const lines = [
			JSON.stringify({
				ordinal: 5,
				timestamp: "2026-10-02T14:00:00Z",
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "hello" }],
				},
			}),
		];
		const msgs = parseNewMessages(lines, 5);
		expect(msgs).toHaveLength(0);
	});

	it("parses user message from response_item", () => {
		const lines = [
			JSON.stringify({
				ordinal: 10,
				timestamp: "2026-10-02T14:00:00Z",
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "write tests" }],
				},
			}),
		];
		const msgs = parseNewMessages(lines, 0);
		expect(msgs).toHaveLength(1);
		expect(msgs[0].role).toBe("user");
		expect(msgs[0].text).toBe("write tests");
	});

	it("parses assistant message from AgentMessage item_completed", () => {
		const lines = [
			JSON.stringify({
				ordinal: 11,
				timestamp: "2026-10-02T14:00:00Z",
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						type: "AgentMessage",
						content: [{ type: "Text", text: "Here is the plan" }],
					},
				},
			}),
		];
		const msgs = parseNewMessages(lines, 0);
		expect(msgs).toHaveLength(1);
		expect(msgs[0].role).toBe("assistant");
		expect(msgs[0].text).toBe("Here is the plan");
	});

	it("ignores malformed JSON", () => {
		const lines = [
			"not valid json {{{",
			JSON.stringify({
				ordinal: 1,
				timestamp: "",
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "test" }],
				},
			}),
		];
		const msgs = parseNewMessages(lines, 0);
		// Only the well-formed line should produce a message
		expect(msgs).toHaveLength(1);
	});

	it("returns messages sorted by ordinal", () => {
		const lines = [
			JSON.stringify({
				ordinal: 30,
				timestamp: "t",
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "second" }],
				},
			}),
			JSON.stringify({
				ordinal: 10,
				timestamp: "t",
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "first" }],
				},
			}),
		];
		const msgs = parseNewMessages(lines, 0);
		expect(msgs).toHaveLength(2);
		expect(msgs[0].ordinal).toBeLessThan(msgs[1].ordinal);
	});
});

// ---------------------------------------------------------------------------
// classifyMessage
// ---------------------------------------------------------------------------

describe("classifyMessage", () => {
	it('classifies text-only as "plan"', () => {
		expect(
			classifyMessage("# Implementation Plan\n\n1. Step one\n2. Step two"),
		).toBe("plan");
	});

	it('classifies code-only as "code"', () => {
		expect(classifyMessage("```\nconst x = 1;\n```")).toBe("code");
	});

	it('classifies mixed text and code as "mixed"', () => {
		expect(classifyMessage("# Plan\n\n```\nconst x = 1;\n```\n\nDone.")).toBe(
			"mixed",
		);
	});

	it('classifies empty as "unknown"', () => {
		expect(classifyMessage("")).toBe("unknown");
		expect(classifyMessage("   ")).toBe("unknown");
	});
});
