/**
 * Tests for proactive compact threshold decisions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
	getProviderOverloadResumeDelayMs,
	isProviderOverloadAssistantMessage,
	isOutputLimitAssistantMessage,
	shouldQueueOutputLimitResume,
	shouldQueueProviderOverloadResume,
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

test("shouldTriggerProactiveCompact returns true when token headroom is low", () => {
	assert.equal(
		shouldTriggerProactiveCompact({
			tokens: 258000,
			contextWindow: 272000,
			percent: 0.88,
		}),
		true,
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
			stopReason: "max_output_tokens",
		}),
		true,
	);
	assert.equal(
		isOutputLimitAssistantMessage({
			role: "assistant",
			stopReason: "max_tokens",
		}),
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

test("isProviderOverloadAssistantMessage detects transient 529 overload text", () => {
	assert.equal(
		isProviderOverloadAssistantMessage({
			role: "assistant",
			stopReason: "error",
			errorMessage:
				"Retry failed after 3 attempts: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"The system is currently experiencing a peak-hour surge, and the server is temporarily busy. It usually recovers within 1-5 minutes. Please try again shortly (2064) (529)\"}}",
		}),
		true,
	);
	assert.equal(
		isProviderOverloadAssistantMessage({
			role: "assistant",
			content: [{ type: "text", text: "Error: 529 temporarily busy" }],
		}),
		true,
	);
	assert.equal(
		isProviderOverloadAssistantMessage({ role: "assistant", stopReason: "stop" }),
		false,
	);
	assert.equal(
		isProviderOverloadAssistantMessage({ role: "user", errorMessage: "529" }),
		false,
	);
});

test("shouldQueueProviderOverloadResume honors pending messages and attempt limit", () => {
	const message = {
		role: "assistant",
		errorMessage: "overloaded_error: server is temporarily busy (529)",
	};
	assert.equal(shouldQueueProviderOverloadResume(message, 0, false), true);
	assert.equal(shouldQueueProviderOverloadResume(message, 0, true), false);
	assert.equal(
		shouldQueueProviderOverloadResume(message, 3, false, { maxAttempts: 3 }),
		false,
	);
});

test("getProviderOverloadResumeDelayMs returns bounded jitter", () => {
	assert.equal(
		getProviderOverloadResumeDelayMs({
			minMs: 60_000,
			maxMs: 300_000,
			random: () => 0,
		}),
		60_000,
	);
	assert.equal(
		getProviderOverloadResumeDelayMs({
			minMs: 60_000,
			maxMs: 300_000,
			random: () => 1,
		}),
		300_000,
	);
	assert.equal(
		getProviderOverloadResumeDelayMs({
			minMs: 60_000,
			maxMs: 300_000,
			random: () => 0.5,
		}),
		180_000,
	);
});

test("shouldQueuePostCompactionResume respects reason, retry, force, and pending messages", () => {
	assert.equal(
		shouldQueuePostCompactionResume(
			{ willRetry: false, reason: "manual" },
			false,
		),
		false,
	);
	assert.equal(
		shouldQueuePostCompactionResume(
			{ willRetry: false, reason: "overflow" },
			false,
		),
		true,
	);
	assert.equal(
		shouldQueuePostCompactionResume(
			{ willRetry: false, reason: "threshold" },
			false,
		),
		true,
	);
	assert.equal(
		shouldQueuePostCompactionResume(
			{ willRetry: true, reason: "overflow" },
			false,
		),
		false,
	);
	assert.equal(
		shouldQueuePostCompactionResume(
			{ willRetry: true, reason: "manual" },
			false,
			{ force: true },
		),
		true,
	);
	assert.equal(
		shouldQueuePostCompactionResume(
			{ willRetry: false, reason: "overflow" },
			true,
		),
		false,
	);
});
