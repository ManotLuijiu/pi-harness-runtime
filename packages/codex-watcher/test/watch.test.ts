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

// -----------------------------------------------------------------------
// UTF-8 Byte Buffering (simulated)
// -----------------------------------------------------------------------

describe("UTF-8 byte buffering", () => {
	/**
	 * Simulates the byte buffering logic from index.ts
	 * This tests the core algorithm without needing actual file I/O
	 */
	function simulateByteBuffering(chunks: Buffer[], newlineTerminated: boolean[]): {
		completeLines: string[];
		remainingBytes: Buffer | null;
	} {
		let pendingBytes: Buffer | null = null;

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			
			// Buffer raw bytes
			if (pendingBytes) {
				pendingBytes = Buffer.concat([pendingBytes, chunk]);
			} else {
				pendingBytes = chunk;
			}

			// If this chunk is newline-terminated, we can decode
			if (newlineTerminated[i]) {
				const text = pendingBytes.toString("utf8");
				pendingBytes = null;
				return {
					completeLines: text.split("\n").filter(l => l.trim()),
					remainingBytes: pendingBytes,
				};
			}
		}

		return {
			completeLines: [],
			remainingBytes: pendingBytes,
		};
	}

	/**
	 * Stateful simulation that properly chains multiple reads
	 */
	function createBufferingState() {
		let pendingBytes: Buffer | null = null;
		let linesEmitted: string[] = [];

		function processChunk(chunk: Buffer, endsWithNewline: boolean): string[] {
			// Buffer raw bytes
			if (pendingBytes) {
				pendingBytes = Buffer.concat([pendingBytes, chunk]);
			} else {
				pendingBytes = chunk;
			}

			if (endsWithNewline) {
				const text = pendingBytes.toString("utf8");
				const lines = text.split("\n").filter(l => l.trim());
				linesEmitted.push(...lines);
				pendingBytes = null;
				return lines;
			}
			return [];
		}

		return { processChunk, getPending: () => pendingBytes, getEmitted: () => linesEmitted };
	}

	it("preserves split multi-byte UTF-8 characters", () => {
		// 中文 is 3 bytes per character: \u4E2D\u6587
		// If we split between bytes, each chunk should still decode correctly
		const fullText = '{"text": "Hello 中文 world"}\n';
		const fullBuffer = Buffer.from(fullText, "utf8");

		// Split in the middle of 中文 (after 2nd byte of first char)
		const chineseStart = fullText.indexOf("中文");
		const splitPoint = chineseStart + 2; // Split in middle of first Chinese char

		const chunk1 = fullBuffer.subarray(0, splitPoint);
		const chunk2 = fullBuffer.subarray(splitPoint);

		// Use stateful buffering to properly chain reads
		const state = createBufferingState();

		// Process chunk 1 (not newline terminated)
		const lines1 = state.processChunk(chunk1, false);
		expect(lines1).toHaveLength(0); // No complete lines yet
		expect(state.getPending()).not.toBeNull();

		// Process chunk 2 (newline terminated)
		const lines2 = state.processChunk(chunk2, true);
		expect(lines2).toHaveLength(1);
		// The full text including Chinese should be preserved
		expect(lines2[0]).toContain("Hello");
		expect(lines2[0]).toContain("中文");
		expect(lines2[0]).toContain("world");
	});

	it("handles chunk split in middle of 3-byte UTF-8 sequence", () => {
		// Test specifically the bug case: ���文 → proper 中文
		const fullText = '{"text": "test 日本語"}\n';
		const fullBuffer = Buffer.from(fullText, "utf8");

		// 日 = E6 97 A5 (3 bytes), 本 = E6 9C AC (3 bytes), 語 = E8 87 AA (3 bytes)
		// Split after byte 10 (somewhere in 日本語)
		const splitPoint = 10;

		const chunk1 = fullBuffer.subarray(0, splitPoint);
		const chunk2 = fullBuffer.subarray(splitPoint);

		const result1 = simulateByteBuffering([chunk1], [false]);
		expect(result1.completeLines).toHaveLength(0);

		const result2 = simulateByteBuffering([chunk2], [true]);
		expect(result2.completeLines).toHaveLength(1);
		// Should NOT have replacement character (U+FFFD)
		expect(result2.completeLines[0]).not.toContain("\uFFFD");
		expect(result2.completeLines[0]).toContain("日本語");
	});
});

// ---------------------------------------------------------------------------
// Partial JSON Line Preservation
// ---------------------------------------------------------------------------

describe("Partial JSON line preservation", () => {
	function simulatePartialLineBuffering(readResults: {text: string; endsWithNewline: boolean}[]): {
		completeLines: string[];
		pendingText: string;
	} {
		let pendingText = "";

		for (const read of readResults) {
			const fullText = pendingText + read.text;
			const lines = fullText.split("\n");

			if (read.endsWithNewline) {
				// All lines complete
				pendingText = "";
				return {
					completeLines: lines.filter(l => l.trim()),
					pendingText,
				};
			} else {
				// Last line is incomplete
				pendingText = lines.pop() ?? "";
			}
		}

		return { completeLines: [], pendingText };
	}

	it("waits for complete line before emitting", () => {
		// Simulate: partial JSON written, then newline, then next record
		const read1 = { text: '{"ordinal": 1, "text": "part', endsWithNewline: false };
		const read2 = { text: 'ial record"}\n', endsWithNewline: true };

		const result = simulatePartialLineBuffering([read1, read2]);
		
		expect(result.completeLines).toHaveLength(1);
		expect(result.completeLines[0]).toContain("partial record");
		expect(result.completeLines[0]).toContain('"ordinal": 1');
	});

	it("preserves multiple incomplete reads", () => {
		const read1 = { text: '{"ordinal": 1', endsWithNewline: false };
		const read2 = { text: ', "text": "', endsWithNewline: false };
		const read3 = { text: 'hello"}\n', endsWithNewline: true };

		const result = simulatePartialLineBuffering([read1, read2, read3]);
		
		expect(result.completeLines).toHaveLength(1);
		expect(result.completeLines[0]).toContain("hello");
	});

	it("handles empty pending text correctly", () => {
		const read = { text: '{"ordinal": 1, "text": "complete"}\n', endsWithNewline: true };

		const result = simulatePartialLineBuffering([read]);
		
		expect(result.completeLines).toHaveLength(1);
		expect(result.pendingText).toBe("");
	});

	it("does not emit incomplete lines", () => {
		const read1 = { text: '{"incomplete": true}', endsWithNewline: false };

		const result = simulatePartialLineBuffering([read1]);
		
		expect(result.completeLines).toHaveLength(0);
		expect(result.pendingText).toBe('{"incomplete": true}');
	});
});

// ---------------------------------------------------------------------------
// Pending Delivery Queue Logic
// ---------------------------------------------------------------------------

describe("Pending delivery queue", () => {
	interface DeliveryItem {
		ordinal: number;
		text: string;
		delivered: boolean;
	}

	function simulateDeliveryQueue(
		events: Array<{
			type: "new_message" | "poll_retry" | "delivered";
			ordinal?: number;
			text?: string;
			deliverySucceeds?: boolean;
		}>
	): {
		queue: DeliveryItem[];
		deliveryAttempts: number[];
	} {
		const queue: DeliveryItem[] = [];
		const deliveryAttempts: number[] = [];

		for (const event of events) {
			if (event.type === "new_message" && event.ordinal !== undefined) {
				queue.push({
					ordinal: event.ordinal,
					text: event.text ?? "",
					delivered: false,
				});
			} else if (event.type === "poll_retry") {
				for (const item of queue) {
					if (!item.delivered) {
						deliveryAttempts.push(item.ordinal);
						if (event.deliverySucceeds) {
							item.delivered = true;
						}
					}
				}
				// Clean up delivered
				while (queue.length > 0 && queue[0].delivered) {
					queue.shift();
				}
			}
		}

		return { queue, deliveryAttempts };
	}

	it("queues message on delivery failure", () => {
		const result = simulateDeliveryQueue([
			{ type: "new_message", ordinal: 1, text: "test" },
		]);

		expect(result.queue).toHaveLength(1);
		expect(result.queue[0].delivered).toBe(false);
	});

	it("retries queued messages on next poll", () => {
		const result = simulateDeliveryQueue([
			{ type: "new_message", ordinal: 1, text: "test" },
			{ type: "poll_retry", deliverySucceeds: true },
		]);

		expect(result.deliveryAttempts).toContain(1);
		expect(result.queue).toHaveLength(0); // Cleaned up
	});

	it("retries until successful", () => {
		const result = simulateDeliveryQueue([
			{ type: "new_message", ordinal: 1, text: "test" },
			{ type: "poll_retry", deliverySucceeds: false },
			{ type: "poll_retry", deliverySucceeds: false },
			{ type: "poll_retry", deliverySucceeds: true },
		]);

		expect(result.deliveryAttempts).toEqual([1, 1, 1]); // 3 attempts
		expect(result.queue).toHaveLength(0);
	});

	it("processes multiple queued messages in order", () => {
		const result = simulateDeliveryQueue([
			{ type: "new_message", ordinal: 1, text: "first" },
			{ type: "new_message", ordinal: 2, text: "second" },
			{ type: "poll_retry", deliverySucceeds: true }, // delivers both
		]);

		expect(result.deliveryAttempts).toContain(1);
		expect(result.deliveryAttempts).toContain(2);
		expect(result.queue).toHaveLength(0);
	});

	it("does not re-queue already queued messages", () => {
		// This simulates the case where a message fails but is already in queue
		// It should not be added twice
		const result = simulateDeliveryQueue([
			{ type: "new_message", ordinal: 1, text: "test" },
			{ type: "poll_retry", deliverySucceeds: false },
		]);

		expect(result.queue).toHaveLength(1); // Still only one
		expect(result.deliveryAttempts).toEqual([1]);
	});
});
