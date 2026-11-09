/**
 * The watcher of the tools of the Honcho MCP server.
 *
 * A connector connects the registered servers asynchronously. The watcher
 * looks for the tools, reports a failure at the deadline, and corrects the
 * row when a slow connector finally connects. The clock and the timers are
 * injected, so the behaviour is deterministic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { watchHonchoMcpTools } from "../harness/honcho-mcp-watcher.ts";

/** A watcher with an injected clock, timers, log and row. */
function setup({ state = "registered", reason } = {}) {
	let now = 0;
	const timers = new Map();
	let seq = 0;
	const logs = [];
	const rows = [];
	let current = state;

	const stop = watchHonchoMcpTools({
		readState: () => current,
		readFailureReason: () => reason,
		report: (theState, theReason) =>
			theState === "connected"
				? { text: "MCP connected", status: "ok", details: [] }
				: { text: "MCP registered, not connected", status: "warn", details: theReason ? [`The connection failed: ${theReason}`] : [] },
		log: (message) => logs.push(message),
		setRow: (label, text, status, details) => rows.push({ label, text, status, details }),
		now: () => now,
		setTimeout: (callback, ms) => {
			seq += 1;
			timers.set(seq, { callback, at: now + ms });
			return seq;
		},
		clearTimeout: (handle) => timers.delete(handle),
		waitMs: 1_000,
		intervalMs: 100,
		lateIntervalMs: 500,
	});

	/** Let the time pass and run the timers that are due. */
	const tick = (ms) => {
		now += ms;
		for (const [handle, timer] of [...timers]) {
			if (timer.at <= now) {
				timers.delete(handle);
				timer.callback();
			}
		}
	};

	return {
		logs,
		rows,
		stop,
		tick,
		connect: () => {
			current = "connected";
		},
		pendingTimers: () => timers.size,
	};
}

test("a connection before the deadline is reported as connected", () => {
	const s = setup();

	s.tick(100);
	s.connect();
	s.tick(100);

	assert.equal(s.logs.length, 1, "the log names the connection");
	assert.match(s.logs[0], /native MCP server connected/, "the log names the connection");
	assert.equal(s.rows.length, 1, "the row reports the state");
	assert.equal(s.rows[0].text, "MCP connected", "the row says that the server is connected");
	assert.equal(s.rows[0].status, "ok", "a connected server is not a warning");
});

test("the deadline reports the failure once", () => {
	const s = setup({ reason: "the server refused the credential" });

	s.tick(1_000);
	assert.equal(s.logs.length, 1, "the deadline reports the failure");
	assert.match(s.logs[0], /no connector connected the MCP server/, "the log names the failure");
	assert.match(s.logs[0], /the server refused the credential/, "the log carries the reason");
	assert.equal(s.rows.length, 1, "the row reports the failure");
	assert.equal(s.rows[0].status, "warn", "a missing connection is a warning");

	s.tick(2_000);
	assert.equal(s.logs.length, 1, "the failure is reported once");
	assert.equal(s.rows.length, 1, "the row is written once");
});

test("a slow connector is not a failed one: the row is corrected when the tools appear", () => {
	const s = setup({ reason: "the handshake timed out" });

	// The deadline passes with no connection.
	s.tick(1_000);
	assert.equal(s.rows[0].text, "MCP registered, not connected", "the row says that the server is not connected");
	assert.match(s.rows[0].details[0], /the handshake timed out/, "the row carries the reason");

	// The connector connects later.
	s.connect();
	s.tick(1_500);

	assert.equal(s.logs.length, 2, "the connection is logged");
	assert.match(s.logs[1], /native MCP server connected/, "the log names the connection");
	assert.equal(s.rows.length, 2, "the row is corrected");
	assert.equal(s.rows[1].text, "MCP connected", "the row says that the server is connected");
	assert.equal(s.rows[1].status, "ok", "the corrected row is not a warning");
	// The correction replaces the row: both rows carry the same label.
	assert.equal(s.rows[0].label, s.rows[1].label, "the correction carries the same label");
});

test("a watcher that is stopped reads no more of the session", () => {
	const s = setup();

	s.stop();
	s.connect();
	s.tick(5_000);

	assert.equal(s.logs.length, 0, "a stopped watcher reports nothing");
	assert.equal(s.rows.length, 0, "a stopped watcher writes no row");
});

test("a watcher without a failure reason reports the failure without a row", () => {
	const s = setup({ reason: undefined });

	s.tick(1_000);

	assert.equal(s.logs.length, 1, "the deadline reports the failure");
	assert.match(s.logs[0], /no connector connected the MCP server/, "the log names the failure");
	assert.equal(s.rows.length, 0, "a failure without a reason leaves the row alone");
});
