import { test } from "node:test";
import assert from "node:assert/strict";
import { QuotaLowRemainingTracker } from "../harness/quota-low-remaining.ts";

test("the allowance below ten percent alerts once", () => {
	const tracker = new QuotaLowRemainingTracker();
	// 9.9% left: the used percentage is 90.1.
	assert.equal(tracker.observe("minimax", 90.1), "notify");
	// The same state again is not a new crossing.
	assert.equal(tracker.observe("minimax", 90.1), "silent");
	assert.equal(tracker.observe("minimax", 95), "silent");
	assert.equal(tracker.isAlerted("minimax"), true);
});

test("ten percent of the allowance left is not below the threshold", () => {
	const tracker = new QuotaLowRemainingTracker();
	assert.equal(tracker.observe("minimax", 90), "none");
	assert.equal(tracker.observe("minimax", 89), "none");
	assert.equal(tracker.isAlerted("minimax"), false);
});

test("an empty window alerts as well", () => {
	const tracker = new QuotaLowRemainingTracker();
	assert.equal(tracker.observe("minimax", 100), "notify");
	assert.equal(tracker.observe("minimax", 100), "silent");
});

test("an allowance that recovers arms the alert again", () => {
	const tracker = new QuotaLowRemainingTracker();
	assert.equal(tracker.observe("minimax", 90.1), "notify");
	assert.equal(tracker.observe("minimax", 40), "rearmed");
	assert.equal(tracker.isAlerted("minimax"), false);
	// The next crossing alerts again.
	assert.equal(tracker.observe("minimax", 95), "notify");
});

test("an allowance that recovers without an alert changes nothing", () => {
	const tracker = new QuotaLowRemainingTracker();
	assert.equal(tracker.observe("minimax", 40), "none");
});

test("a capture that says nothing changes nothing", () => {
	const tracker = new QuotaLowRemainingTracker();
	assert.equal(tracker.observe("minimax", undefined), "none");
	assert.equal(tracker.observe("minimax", Number.NaN), "none");
	// An unknown capture does not disarm the alert either.
	assert.equal(tracker.observe("minimax", 90.1), "notify");
	assert.equal(tracker.observe("minimax", undefined), "none");
	assert.equal(tracker.observe("minimax", 90.1), "silent");
});

test("the alert of one provider does not silence the alert of another", () => {
	const tracker = new QuotaLowRemainingTracker();
	assert.equal(tracker.observe("minimax", 90.1), "notify");
	assert.equal(tracker.observe("glm", 90.1), "notify");
	assert.equal(tracker.observe("minimax", 90.1), "silent");
});
