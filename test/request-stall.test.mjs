/**
 * The pause of a request that the human can see and lift.
 *
 * A request that did not progress is paused, not finished. The pause has
 * to be visible - the reason in the row of the footer and a notice once -
 * and it has to be liftable through a supported path that does not reset
 * the request.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	REQUEST_RECOVERY_COMMAND,
	RequestStallHost,
	stallReason,
	stallStatus,
} from "../harness/request-stall.ts";

/** A host with the seams of the session. */
function host(facts, overrides = {}) {
	const state = { ...facts };
	const statuses = [];
	const notices = [];
	const resumed = [];
	const continued = [];
	const instance = new RequestStallHost({
		read: () => state,
		setStatus: (text) => statuses.push(text),
		notify: (message, level) => notices.push({ message, level }),
		resume: () => {
			resumed.push(true);
			state.stalled = false;
			state.reason = undefined;
			return true;
		},
		continue: async () => {
			continued.push(true);
			return true;
		},
		...overrides,
	});
	return { instance, state, statuses, notices, resumed, continued };
}

test("the row of the footer is empty while the request runs", () => {
	const status = stallStatus({ stalled: false });
	assert.equal(status.key, "running");
	assert.equal(status.text, "");
});

test("the row of the footer names the reason of the pause and the way out", () => {
	const status = stallStatus({
		stalled: true,
		reason: "the request continued for the same open work 3 times",
	});
	assert.equal(status.key, "paused");
	assert.match(status.text, /continued for the same open work 3 times/);
	assert.match(status.text, /work of the request stays open/);
	assert.ok(status.text.includes(REQUEST_RECOVERY_COMMAND));
});

test("a pause without a reason says that the request did not progress", () => {
	assert.match(stallReason({ stalled: true }), /did not progress/);
	assert.match(stallReason({ stalled: true, reason: "because." }), /because\./);
});

test("the notice of a pause is shown once", () => {
	const { instance, statuses, notices } = host({
		stalled: true,
		reason: "the work did not move",
	});
	instance.sync();
	instance.sync();
	instance.sync();
	assert.equal(notices.length, 1);
	assert.match(notices[0].message, /paused/);
	assert.match(notices[0].message, /work did not move/);
	assert.ok(notices[0].message.includes(REQUEST_RECOVERY_COMMAND));
	// The row carries the reason as well, and it is written every time.
	assert.equal(statuses.length, 3);
	assert.match(statuses[0], /work did not move/);
});

test("a request that runs again is noticed again when it pauses", () => {
	const { instance, state, notices } = host({ stalled: false });
	instance.sync();
	assert.equal(notices.length, 0);
	state.stalled = true;
	state.reason = "the work did not move";
	instance.sync();
	assert.equal(notices.length, 1);
	state.stalled = false;
	instance.sync();
	state.stalled = true;
	instance.sync();
	assert.equal(notices.length, 2);
});

test("the recovery lifts the pause and continues the request", async () => {
	const { instance, resumed, continued, statuses } = host({
		stalled: true,
		reason: "the work did not move",
	});
	instance.sync();
	const result = await instance.recover();
	assert.equal(result.ok, true);
	assert.match(result.message, /continues/);
	assert.equal(resumed.length, 1);
	// The continuation goes through the guarded path of the session.
	assert.equal(continued.length, 1);
	// The row of the footer does not claim a pause any more.
	instance.sync();
	assert.equal(statuses.at(-1), "");
});

test("the recovery of a finished request is refused", async () => {
	const { instance, resumed, continued } = host({
		stalled: true,
		terminal: true,
		reason: "the work did not move",
	});
	const result = await instance.recover();
	assert.equal(result.ok, false);
	assert.match(result.message, /finished/);
	assert.equal(resumed.length, 0);
	assert.equal(continued.length, 0);
});

test("the recovery of a request that is not paused is refused", async () => {
	const { instance, resumed, continued } = host({ stalled: false });
	const result = await instance.recover();
	assert.equal(result.ok, false);
	assert.match(result.message, /not paused/);
	assert.equal(resumed.length, 0);
	assert.equal(continued.length, 0);
});

test("a guard that stops the continuation is reported", async () => {
	const { instance } = host(
		{ stalled: true, reason: "the work did not move" },
		{ continue: async () => false },
	);
	const result = await instance.recover();
	assert.equal(result.ok, false);
	assert.match(result.message, /guards of the session/);
});

test("a state that cannot be read does not break the request", () => {
	const { instance, statuses, notices } = host({}, {
		read: () => {
			throw new Error("the provider is gone");
		},
	});
	instance.sync();
	assert.equal(statuses.length, 0);
	assert.equal(notices.length, 0);
});
