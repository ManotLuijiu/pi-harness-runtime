/**
 * Tests for MiniMax quota text parsing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMiniMaxQuotaText } from "../harness/e2e/minimax-quota-parser.ts";

test("parseMiniMaxQuotaText extracts 5h and weekly usage from visible text", () => {
	const parsed = parseMiniMaxQuotaText(`
Token Plan · Monthly Plus
My usage
5h limit
Resets in 1 hr 27 min
Total quota 100%
Used 0%
Weekly limit
Resets in 1 day 15 hr
Total quota 100%
Used 48%
`);

	assert.equal(parsed.h5UsedPct, 0);
	assert.equal(parsed.h5ResetsAt, "1 hr 27 min");
	assert.equal(parsed.weeklyUsedPct, 48);
	assert.equal(parsed.weeklyResetsAt, "1 day 15 hr");
});
