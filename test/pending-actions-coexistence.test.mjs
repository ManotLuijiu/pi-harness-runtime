/**
 * The coexistence of the pending automatic actions.
 *
 * Several owners can be pending at the same time: a decision of the judge,
 * a recovery of the provider, the resume of a job, the countdown of a
 * quota, a continuation that runs right away. The rows have to stay
 * coherent, and a blocked action must stay visible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	createPendingActionRegistry,
	formatPendingActions,
} from "../harness/pending-actions.ts";

/** The registry with one action of every kind. */
function registryWithAllKinds(now) {
	const registry = createPendingActionRegistry();
	registry.register({
		id: "jev",
		sessionId: "s-1",
		owner: "jev-decision",
		kind: "jev-decision",
		state: "scheduled",
		dueAt: now + 300_000,
		reason: "the decision of the judge",
	});
	registry.register({
		id: "recovery",
		sessionId: "s-1",
		owner: "provider-recovery",
		kind: "retry",
		state: "scheduled",
		dueAt: now + 120_000,
		attempt: 2,
		maxAttempts: 4,
		provider: "MiniMax",
		code: "2067",
		reason: "MiniMax usage limit reached (2067)",
	});
	registry.register({
		id: "job",
		sessionId: "s-1",
		owner: "job-quota",
		kind: "resume",
		state: "scheduled",
		dueAt: now + 60_000,
		provider: "minimax",
		reason: "the quota of the job is exhausted",
	});
	registry.register({
		id: "quota",
		sessionId: "s-1",
		owner: "glm-quota",
		kind: "quota-check",
		state: "scheduled",
		dueAt: now + 90_000,
		provider: "GLM",
		reason: "the quota of GLM is exhausted",
	});
	registry.register({
		id: "continuation",
		sessionId: "s-1",
		owner: "continuation",
		kind: "resume",
		state: "queued",
		reason: "the output limit continues the turn",
	});
	return registry;
}

test("every kind names what it waits for", () => {
	const now = 1_000_000;
	const rows = formatPendingActions(registryWithAllKinds(now).list(), now);

	const decision = rows.find((row) => row.includes("Jev decision"));
	assert.ok(decision, "the decision has a row");
	assert.match(decision, /decision in 05:00/);
	assert.match(decision, /\[WAIT\]/);

	const recovery = rows.find((row) => row.includes("MiniMax 2067"));
	assert.ok(recovery, "the recovery has a row");
	assert.match(recovery, /auto-resume in 02:00/);
	assert.match(recovery, /attempt 2\/4/);

	const job = rows.find((row) => row.includes("minimax"));
	assert.ok(job, "the job resume has a row");
	assert.match(job, /auto-resume in 01:00/);

	const quota = rows.find((row) => row.includes("GLM"));
	assert.ok(quota, "the quota check has a row");
	assert.match(quota, /check in 01:30/);

	const continuation = rows.find((row) => row.includes("continues the turn"));
	assert.ok(continuation, "the continuation has a row");
	assert.match(continuation, /queued/);
	assert.doesNotMatch(
		continuation,
		/in \d\d:\d\d/,
		"a continuation that runs right away has no countdown",
	);
});

test("a blocked action stays visible next to the other rows", () => {
	const now = 1_000_000;
	const registry = registryWithAllKinds(now);
	registry.register({
		id: "blocked",
		sessionId: "s-1",
		owner: "provider",
		kind: "retry",
		state: "blocked",
		provider: "MiniMax",
		code: "2067",
		reason: "recovery attempts exhausted (4/4)",
	});

	const rows = formatPendingActions(registry.list(), now);

	assert.equal(rows.length, 6);
	assert.match(rows[0], /^\[BLOCKED\] MiniMax 2067 \| recovery attempts exhausted \(4\/4\)$/);
	// The countdowns follow, the nearest deadline first.
	assert.match(rows[1], /in 01:00/, "the nearest deadline comes first");
	assert.match(rows[2], /in 01:30/);
	assert.match(rows[3], /in 02:00/);
	assert.match(rows[4], /in 05:00/);
});

test("a cancelled action leaves the rows", () => {
	const now = 1_000_000;
	const registry = registryWithAllKinds(now);

	assert.equal(registry.remove("recovery"), true);
	const rows = formatPendingActions(registry.list(), now);

	assert.equal(rows.length, 4);
	assert.equal(
		rows.some((row) => row.includes("MiniMax 2067")),
		false,
		"the cancelled recovery has no row",
	);
});

test("a task completion does not overwrite a blocked action", () => {
	const now = 1_000_000;
	const registry = createPendingActionRegistry();
	registry.register({
		id: "blocked",
		sessionId: "s-1",
		owner: "provider",
		kind: "retry",
		state: "blocked",
		provider: "MiniMax",
		reason: "recovery attempts exhausted (4/4)",
	});

	// Another status of the session is set: it does not touch the rows of
	// the pending actions.
	const rows = formatPendingActions(registry.list(), now);

	assert.equal(rows.length, 1);
	assert.match(rows[0], /^\[BLOCKED\]/);
});
