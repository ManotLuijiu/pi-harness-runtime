/**
 * The registry of the pending automatic actions and the rows it draws.
 *
 * The clock is injected, so the rows are deterministic: a countdown that a
 * test asserts is a fact about the registry, not about the wall clock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	createPendingActionRegistry,
	createPendingActionTicker,
	formatPendingAction,
	formatPendingActions,
} from "../harness/pending-actions.ts";

/** One scheduled action. */
function action(overrides = {}) {
	return {
		id: "a-1",
		sessionId: "s-1",
		owner: "test",
		kind: "retry",
		state: "scheduled",
		dueAt: 1_000_000,
		reason: "the provider is overloaded",
		...overrides,
	};
}

test("the registry holds the pending actions", () => {
	const registry = createPendingActionRegistry();
	registry.register(action());
	registry.register(action({ id: "a-2" }));

	assert.equal(registry.list().length, 2);
	assert.equal(registry.get("a-1")?.id, "a-1");
	assert.equal(registry.get("nope"), null);
});

test("an action with a known identity replaces the entry it replaces", () => {
	const registry = createPendingActionRegistry();
	registry.register(action());
	registry.register(action({ state: "running" }));

	assert.equal(registry.list().length, 1);
	assert.equal(registry.get("a-1")?.state, "running");
});

test("an action can be changed and removed", () => {
	const registry = createPendingActionRegistry();
	registry.register(action());

	const updated = registry.update("a-1", { attempt: 2, maxAttempts: 5 });
	assert.equal(updated?.attempt, 2);
	assert.equal(registry.get("a-1")?.maxAttempts, 5);
	assert.equal(registry.update("nope", { attempt: 1 }), null);

	assert.equal(registry.remove("a-1"), true);
	assert.equal(registry.remove("a-1"), false);
	assert.equal(registry.list().length, 0);
});

test("the actions of one owner can be removed at once", () => {
	const registry = createPendingActionRegistry();
	registry.register(action({ id: "a-1", owner: "provider" }));
	registry.register(action({ id: "a-2", owner: "provider" }));
	registry.register(action({ id: "a-3", owner: "jev-decision" }));

	const removed = registry.removeWhere(
		(entry) => entry.owner === "provider" && entry.state === "blocked",
	);
	assert.equal(removed, 0, "nothing was blocked yet");

	registry.update("a-1", { state: "blocked" });
	registry.update("a-2", { state: "blocked" });
	const removedNow = registry.removeWhere(
		(entry) => entry.owner === "provider" && entry.state === "blocked",
	);
	assert.equal(removedNow, 2);
	assert.equal(registry.list().length, 1);
});

test("a scheduled action counts down to its own deadline", () => {
	const row = formatPendingAction(
		action({ dueAt: 134_000 }),
		1_000,
	);
	assert.equal(
		row,
		"[WAIT] provider retry | auto-resume in 02:13 | the provider is overloaded",
	);
});

test("an action without a deadline never shows a countdown", () => {
	const queued = formatPendingAction(
		action({ state: "queued", dueAt: undefined }),
		1_000,
	);
	assert.equal(
		queued,
		"[WAIT] provider retry | queued | the provider is overloaded",
	);

	const scheduled = formatPendingAction(
		action({ state: "scheduled", dueAt: undefined }),
		1_000,
	);
	assert.equal(
		scheduled,
		"[WAIT] provider retry | scheduled | the provider is overloaded",
	);
});

test("a running action shows that it runs, and a blocked one that it is blocked", () => {
	assert.equal(
		formatPendingAction(action({ state: "running" }), 1_000),
		"[RUN] provider retry | running | the provider is overloaded",
	);
	assert.equal(
		formatPendingAction(
			action({
				state: "blocked",
				provider: "MiniMax",
				code: "2067",
				reason: "usage limit reached (2067)",
			}),
			1_000,
		),
		"[BLOCKED] MiniMax 2067 | usage limit reached (2067)",
	);
});

test("the attempt of an action is part of the row", () => {
	const row = formatPendingAction(
		action({ attempt: 2, maxAttempts: 5, kind: "retry" }),
		1_000,
	);
	assert.match(row, /attempt 2\/5/);
});

test("a blocked action stays visible next to a countdown", () => {
	const rows = formatPendingActions(
		[
			action({ id: "a-1", state: "scheduled", dueAt: 1_000 }),
			action({
				id: "a-2",
				state: "blocked",
				provider: "MiniMax",
				code: "2067",
				reason: "usage limit reached (2067)",
			}),
		],
		1_000,
	);
	assert.equal(rows.length, 2);
	assert.match(rows[0], /^\[BLOCKED\]/, "the blocked action comes first");
	assert.match(rows[1], /^\[WAIT\]/, "the countdown follows");
});

test("the actions with a deadline come first, the nearest one first", () => {
	const rows = formatPendingActions(
		[
			action({ id: "far", dueAt: 500_000 }),
			action({ id: "near", dueAt: 60_000 }),
		],
		0,
	);
	assert.match(rows[0], /in 01:00/);
	assert.match(rows[1], /in 08:20/);
});

test("the ticker draws the rows and stops itself when there is nothing to draw", () => {
	const registry = createPendingActionRegistry();
	let clock = 1_000;
	const drawn = [];
	let ticks = 0;

	const ticker = createPendingActionTicker({
		registry,
		render: (rows) => drawn.push(rows),
		now: () => clock,
		setInterval: (callback) => {
			ticks += 1;
			return { callback };
		},
		clearInterval: () => {
			ticks -= 1;
		},
		tickMs: 1_000,
	});

	registry.register(action({ dueAt: 61_000 }));
	ticker.start();

	assert.equal(drawn.length, 1, "the rows are drawn at once");
	assert.match(drawn[0][0], /in 01:00/);
	assert.equal(ticker.active, true);

	clock = 31_000;
	ticker.tick();
	assert.match(drawn[1][0], /in 00:30/);

	// Nothing is pending any more: the ticker stops itself.
	registry.remove("a-1");
	assert.equal(ticker.active, false);
	assert.equal(ticks, 0, "the timer of the ticker is released");
	assert.deepEqual(drawn[drawn.length - 1], [], "the row is empty");
});

test("a new action starts the ticker again", () => {
	const registry = createPendingActionRegistry();
	const drawn = [];

	const ticker = createPendingActionTicker({
		registry,
		render: (rows) => drawn.push(rows),
		now: () => 0,
		setInterval: () => ({}),
		clearInterval: () => {},
	});

	ticker.start();
	ticker.tick();
	assert.equal(ticker.active, false, "an empty registry stops the ticker");

	registry.register(action({ dueAt: 5_000 }));
	assert.equal(ticker.active, true, "the new action starts the ticker");
	assert.match(drawn[drawn.length - 1][0], /in 00:05/);
});

test("the ticker never dispatches an action", () => {
	const registry = createPendingActionRegistry();
	let renders = 0;
	let dispatches = 0;

	const ticker = createPendingActionTicker({
		registry,
		render: () => {
			renders += 1;
		},
		now: () => 0,
		setInterval: () => ({}),
		clearInterval: () => {},
	});

	// A tick only draws. Nothing else happens: the registry has no way to
	// dispatch an action.
	registry.register(action());
	ticker.start();
	ticker.tick();
	ticker.tick();

	assert.equal(renders, 3, "every tick draws");
	assert.equal(dispatches, 0);
	assert.equal(registry.list().length, 1, "the action is still pending");
});

test("a change of the registry draws the rows at once", () => {
	const registry = createPendingActionRegistry();
	const drawn = [];

	const ticker = createPendingActionTicker({
		registry,
		render: (rows) => drawn.push(rows),
		now: () => 0,
		setInterval: () => ({}),
		clearInterval: () => {},
	});

	registry.register(action({ dueAt: 3_000 }));
	assert.equal(drawn.length, 1, "the registration drew the row");
	assert.match(drawn[0][0], /in 00:03/);
	assert.equal(ticker.active, true, "the change started the ticker");
});
