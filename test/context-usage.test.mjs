/**
 * The fill of the context window, in one unit.
 *
 * The installed pi reports a percentage and not a fraction, so the
 * thresholds of the harness are percentage points.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	contextAtLeast,
	contextFillPercent,
} from "../harness/context-usage.ts";
import {
	PROACTIVE_COMPACT_THRESHOLD,
	shouldTriggerProactiveCompact,
} from "../proactive-compact.ts";

test("the ratio of the tokens is the measurement of the fill", () => {
	assert.equal(
		contextFillPercent({ tokens: 25_000, contextWindow: 100_000 }),
		25,
	);
	assert.equal(
		contextFillPercent({ tokens: 244_800, contextWindow: 272_000 }),
		90,
	);
});

test("the percentage of the usage is the fallback of the fill", () => {
	assert.equal(contextFillPercent({ percent: 75 }), 75);
});

test("an unknown fill stays unknown", () => {
	assert.equal(contextFillPercent(undefined), undefined);
	assert.equal(contextFillPercent(null), undefined);
	assert.equal(contextFillPercent({ tokens: null, contextWindow: 100 }), undefined);
	assert.equal(contextFillPercent({ tokens: 10, contextWindow: 0 }), undefined);
	assert.equal(contextFillPercent({ tokens: Number.NaN, contextWindow: 100 }), undefined);
	assert.equal(contextFillPercent({ percent: Number.NaN }), undefined);
});

test("a window is only full when it is measured", () => {
	assert.equal(contextAtLeast({ tokens: 10_000, contextWindow: 100_000 }, 75), false);
	assert.equal(contextAtLeast({ tokens: 75_000, contextWindow: 100_000 }, 75), true);
	assert.equal(contextAtLeast(undefined, 75), false);
	assert.equal(contextAtLeast({ tokens: null, contextWindow: 100 }, 75), false);
});

test("the proactive compaction waits for ninety percent", () => {
	assert.equal(PROACTIVE_COMPACT_THRESHOLD, 90);
	// Ten percent of the window is not a reason to compact.
	assert.equal(
		shouldTriggerProactiveCompact({
			tokens: 10_000,
			contextWindow: 100_000,
			percent: 10,
		}),
		false,
	);
	// Seventy-five percent is not a reason either.
	assert.equal(
		shouldTriggerProactiveCompact({
			tokens: 75_000,
			contextWindow: 100_000,
			percent: 75,
		}),
		false,
	);
	// Ninety percent is.
	assert.equal(
		shouldTriggerProactiveCompact({
			tokens: 90_000,
			contextWindow: 100_000,
			percent: 90,
		}),
		true,
	);
});
