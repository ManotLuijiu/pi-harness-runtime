/**
 * Tests for proactive compact threshold decisions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { shouldTriggerProactiveCompact } = await import(
	"../proactive-compact.ts"
);

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
