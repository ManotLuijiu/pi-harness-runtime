/**
 * The bounded discovery of the backlog.
 *
 * The tests are about the bounds: a read that happens once, a read that
 * fails and is reported as unavailable, a relevance that is decided before
 * the cap, and the difference between the work of a request and the work
 * that only looks like it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	BdDiscovery,
	selectRelevantIssues,
} from "../harness/bd-discovery.ts";

const issue = (id, title, extra = {}) => ({
	id,
	title,
	status: "open",
	...extra,
});

const scan = (issues) => ({
	available: true,
	issues,
	scannedAt: 1000,
});

test("an issue that the request authorizes is work of the request", () => {
	const result = selectRelevantIssues(
		scan([issue("a-1", "repair the phase"), issue("b-2", "unrelated thing")]),
		{ authorizedIds: ["a-1"] },
	);
	assert.equal(result.relevant.length, 1);
	assert.equal(result.relevant[0].issue.id, "a-1");
	assert.equal(result.relevant[0].authorized, true);
	assert.equal(result.relevant[0].reason, "authorized");
});

test("a named issue is a candidate and not an authorization", () => {
	const result = selectRelevantIssues(scan([issue("a-1", "repair the phase")]), {
		namedIds: ["a-1"],
	});
	assert.equal(result.relevant.length, 1);
	assert.equal(result.relevant[0].authorized, false);
	assert.equal(result.relevant[0].reason, "named");
});

test("a title that matches contributes a candidate only", () => {
	const result = selectRelevantIssues(scan([issue("a-1", "repair the phase")]), {
		requestText: "please repair the phase of the workflow",
	});
	assert.equal(result.relevant.length, 1);
	assert.equal(result.relevant[0].authorized, false);
	assert.equal(result.relevant[0].reason, "related");
});

test("an unrelated issue is left out with a reason", () => {
	const result = selectRelevantIssues(scan([issue("b-2", "unrelated thing")]), {
		requestText: "please repair the phase of the workflow",
	});
	assert.equal(result.relevant.length, 0);
	assert.equal(result.excluded[0].reason, "unrelated");
});

test("a closed, deferred, blocked or claimed issue is never work", () => {
	const result = selectRelevantIssues(
		scan([
			issue("c-1", "closed work", { status: "closed" }),
			issue("d-2", "deferred work", { status: "deferred" }),
			issue("e-3", "blocked work", { status: "blocked" }),
			issue("f-4", "claimed work", { assignee: "other-agent" }),
		]),
		{
			authorizedIds: ["c-1", "d-2", "e-3", "f-4"],
			actor: "minimax",
		},
	);
	assert.equal(result.relevant.length, 0);
	assert.deepEqual(
		result.excluded.map((entry) => entry.reason).sort(),
		["blocked", "claimed", "closed", "deferred"],
	);
});

test("an issue of this actor is not claimed work", () => {
	const result = selectRelevantIssues(
		scan([issue("f-4", "own work", { assignee: "Minimax" })]),
		{ actor: "minimax" },
	);
	assert.equal(
		result.excluded.some((entry) => entry.reason === "claimed"),
		false,
		"the work of this actor is not work of another agent",
	);
});

test("an assigned issue is not claimed work when no actor is known", () => {
	const result = selectRelevantIssues(
		scan([issue("f-4", "assigned work", { assignee: "someone" })]),
		{ requestText: "assigned work" },
	);
	assert.equal(result.relevant.length, 1);
	assert.equal(result.relevant[0].authorized, false);
});

test("the relevance is decided before the cap", () => {
	const issues = [
		issue("u-1", "unrelated one"),
		issue("u-2", "unrelated two"),
		issue("a-9", "the authorized work"),
	];
	const result = selectRelevantIssues(scan(issues), { authorizedIds: ["a-9"] }, 1);
	assert.equal(result.relevant.length, 1);
	assert.equal(result.relevant[0].issue.id, "a-9");
	assert.equal(result.relevantCount, 1);
});

test("a backlog that cannot be read is unavailable, not empty", () => {
	const result = selectRelevantIssues(
		{ available: false, issues: [], reason: "bd is not installed", scannedAt: 1 },
		{},
	);
	assert.equal(result.available, false);
	assert.match(result.reason, /not installed/);
	assert.equal(result.relevant.length, 0);
});

test("the discovery reads the backlog once inside the cooldown", async () => {
	let reads = 0;
	const discovery = new BdDiscovery({
		read: async () => {
			reads += 1;
			return scan([issue("a-1", "work")]);
		},
		ttlMs: 60_000,
		now: () => 1000,
	});
	await discovery.discover();
	await discovery.discover();
	assert.equal(reads, 1);
});

test("a new request does not inherit the read of the old one", async () => {
	let reads = 0;
	let generation = 1;
	const discovery = new BdDiscovery({
		read: async () => {
			reads += 1;
			return scan([issue("a-1", "work")]);
		},
		ttlMs: 60_000,
		generation: () => generation,
		now: () => 1000,
	});
	await discovery.discover();
	generation = 2;
	await discovery.discover();
	assert.equal(reads, 2);
});

test("a read that fails is reported as unavailable and retried later", async () => {
	let reads = 0;
	let now = 1000;
	const discovery = new BdDiscovery({
		read: async () => {
			reads += 1;
			throw new Error("bd timed out");
		},
		ttlMs: 60_000,
		now: () => now,
	});
	const first = await discovery.discover();
	assert.equal(first.available, false);
	assert.match(first.reason ?? "", /bd timed out/);
	now = 1000 + 61_000;
	const second = await discovery.discover();
	assert.equal(second.available, false);
	assert.equal(reads, 2);
});

test("a read that is in flight is shared", async () => {
	let reads = 0;
	const discovery = new BdDiscovery({
		read: async () => {
			reads += 1;
			await new Promise((resolve) => setTimeout(resolve, 5));
			return scan([issue("a-1", "work")]);
		},
		ttlMs: 60_000,
		now: () => 1000,
	});
	await Promise.all([discovery.discover(), discovery.discover()]);
	assert.equal(reads, 1);
});
