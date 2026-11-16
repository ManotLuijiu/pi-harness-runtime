/**
 * The decision of the human about an empty weekly allowance.
 *
 * The decision belongs to the human alone: the judge is never asked, and
 * there is no timeout that decides. The registry holds the first answer,
 * and a button of an old message is stale.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	buildWeeklyRequestId,
	WeeklyExhaustionRegistry,
} from "../harness/weekly-exhaustion-registry.ts";

const NOW = 1_700_000_000_000;
const RESET_AT = NOW + 2 * 86_400_000;

test("the canonical id of a decision holds no underscore", () => {
	const id = buildWeeklyRequestId("minimax", RESET_AT);
	assert.ok(!id.includes("_"), "the callback data is split on the underscore");
	assert.ok(id.startsWith("week-minimax-"));
	assert.equal(id, buildWeeklyRequestId("minimax", RESET_AT), "the id is stable");
	assert.notEqual(
		id,
		buildWeeklyRequestId("minimax", RESET_AT + 1),
		"another reset is another decision",
	);
});

test("the decision waits for the human", () => {
	const registry = new WeeklyExhaustionRegistry();
	const requestId = buildWeeklyRequestId("minimax", RESET_AT);
	const record = registry.register({
		requestId,
		provider: "minimax",
		resetAt: RESET_AT,
		now: NOW,
	});
	assert.equal(record.decision, undefined);
	assert.equal(record.delivered, false);
	assert.equal(registry.pending.length, 1);
});

test("the first answer wins", () => {
	const registry = new WeeklyExhaustionRegistry();
	const requestId = buildWeeklyRequestId("minimax", RESET_AT);
	registry.register({ requestId, provider: "minimax", resetAt: RESET_AT, now: NOW });
	const first = registry.claim(requestId, "countdown", "telegram", NOW);
	assert.equal(first.ok, true);
	assert.equal(first.record.decision, "countdown");
	assert.equal(first.record.channel, "telegram");
	const second = registry.claim(requestId, "manual", "line", NOW);
	assert.equal(second.ok, false, "a second answer is stale");
	assert.match(second.reason, /already made/);
	assert.equal(registry.get(requestId).decision, "countdown");
});

test("an answer for a decision that does not exist is stale", () => {
	const registry = new WeeklyExhaustionRegistry();
	const result = registry.claim("week-minimax-deadbeef", "countdown", "telegram", NOW);
	assert.equal(result.ok, false);
	assert.match(result.reason, /does not exist/);
});

test("the window of the answer starts when the delivery is acknowledged", () => {
	const registry = new WeeklyExhaustionRegistry();
	const requestId = buildWeeklyRequestId("minimax", RESET_AT);
	registry.register({ requestId, provider: "minimax", resetAt: RESET_AT, now: NOW });
	assert.equal(registry.get(requestId).delivered, false, "the message is not there yet");
	assert.equal(registry.markDelivered(requestId), true);
	assert.equal(registry.get(requestId).delivered, true);
	assert.equal(registry.pending.length, 1, "the decision waits for the human");
});

test("a delivery that failed removes the decision", () => {
	const registry = new WeeklyExhaustionRegistry();
	const requestId = buildWeeklyRequestId("minimax", RESET_AT);
	registry.register({ requestId, provider: "minimax", resetAt: RESET_AT, now: NOW });
	assert.equal(registry.remove(requestId), true);
	assert.equal(registry.get(requestId), undefined);
	const result = registry.claim(requestId, "countdown", "telegram", NOW);
	assert.equal(result.ok, false);
});

test("the manual choice leaves the work paused", () => {
	const registry = new WeeklyExhaustionRegistry();
	const requestId = buildWeeklyRequestId("minimax", RESET_AT);
	registry.register({ requestId, provider: "minimax", resetAt: RESET_AT, now: NOW });
	const result = registry.claim(requestId, "manual", "line", NOW);
	assert.equal(result.ok, true);
	assert.equal(result.record.decision, "manual");
	assert.equal(result.record.channel, "line");
});
