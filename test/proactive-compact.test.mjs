/**
 * Tests for proactive compact threshold decisions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
	isOutputLimitAssistantMessage,
	shouldQueueOutputLimitResume,
	shouldQueuePostCompactionResume,
	shouldTriggerProactiveCompact,
} = await import("../proactive-compact.ts");

test("shouldTriggerProactiveCompact returns false when usage is unavailable", () => {
	assert.equal(shouldTriggerProactiveCompact(undefined), false);
	assert.equal(
		shouldTriggerProactiveCompact({
			tokens: null,
			contextWindow: 272000,
			percent: null,
		}),
		false,
	);
});

test("shouldTriggerProactiveCompact returns false below threshold", () => {
	assert.equal(
		shouldTriggerProactiveCompact({
			tokens: 200000,
			contextWindow: 272000,
			percent: 0.89,
		}),
		false,
	);
});

test("shouldTriggerProactiveCompact returns true at threshold", () => {
	assert.equal(
		shouldTriggerProactiveCompact({
			tokens: 244800,
			contextWindow: 272000,
			percent: 0.9,
		}),
		true,
	);
});

test("isOutputLimitAssistantMessage detects length stop and provider text", () => {
	assert.equal(
		isOutputLimitAssistantMessage({ role: "assistant", stopReason: "length" }),
		true,
	);
	assert.equal(
		isOutputLimitAssistantMessage({
			role: "assistant",
			stopReason: "error",
			errorMessage:
				"Model stopped because it reached the maximum output token limit.",
		}),
		true,
	);
	assert.equal(
		isOutputLimitAssistantMessage({ role: "user", stopReason: "length" }),
		false,
	);
});

test("shouldQueueOutputLimitResume honors pending messages and attempt limit", () => {
	const message = { role: "assistant", stopReason: "length" };
	assert.equal(shouldQueueOutputLimitResume(message, 0, false), true);
	assert.equal(shouldQueueOutputLimitResume(message, 0, true), false);
	assert.equal(
		shouldQueueOutputLimitResume(message, 3, false, { maxAttempts: 3 }),
		false,
	);
});

test("shouldQueuePostCompactionResume queues after non-retry compaction only", () => {
	assert.equal(
		shouldQueuePostCompactionResume({ willRetry: false }, false),
		true,
	);
	assert.equal(
		shouldQueuePostCompactionResume({ willRetry: true }, false),
		false,
	);
	assert.equal(
		shouldQueuePostCompactionResume({ willRetry: false }, true),
		false,
	);
});
