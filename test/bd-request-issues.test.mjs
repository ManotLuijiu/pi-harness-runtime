/**
 * The reconciliation of the issues of the backlog that a request authorizes.
 *
 * The tests are about the difference between the work of a request and the
 * work that only looks like it: an issue that the request authorized is
 * work until it is done, an issue that nobody authorized is a candidate
 * and never work, and a backlog that cannot be read leaves the authorized
 * work unknown instead of empty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	RequestIssueTracker,
	issueIdOf,
	reconcileRequestIssues,
} from "../harness/bd-request-issues.ts";
import { readRequestWork } from "../harness/request-lifecycle.ts";

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

/** A todo that carries the link to an issue of the backlog. */
const todo = (id, bdIssueId, extra = {}) => ({
	id,
	status: "pending",
	metadata: bdIssueId ? { bdIssueId } : {},
	...extra,
});

test("the issue a todo carries is read from its metadata", () => {
	assert.equal(issueIdOf(todo(1, "a-1")), "a-1");
	assert.equal(issueIdOf(todo(1, "  a-1  ")), "a-1");
	assert.equal(issueIdOf(todo(1, undefined)), undefined);
	assert.equal(issueIdOf({ id: 2, status: "pending" }), undefined);
});

test("an authorized issue that no todo carries is still outstanding", () => {
	const result = reconcileRequestIssues({
		authorizedIds: ["a-1"],
		items: [todo(1, "b-2")],
		scan: scan([issue("a-1", "repair the phase"), issue("b-2", "other")]),
	});
	assert.deepEqual(result.authorized, ["a-1"]);
	assert.deepEqual(result.outstanding, ["a-1"]);
	assert.deepEqual(result.closed, []);
	assert.equal(result.available, true);
});

test("an authorized issue that a todo carries is linked and not outstanding", () => {
	const result = reconcileRequestIssues({
		authorizedIds: ["a-1"],
		items: [todo(7, "a-1")],
		scan: scan([issue("a-1", "repair the phase")]),
	});
	assert.deepEqual(result.outstanding, []);
	assert.equal(result.linked.length, 1);
	assert.equal(result.linked[0].id, "a-1");
	assert.deepEqual(result.linked[0].todoIds, ["7"]);
});

test("the same todo is never linked twice", () => {
	const result = reconcileRequestIssues({
		authorizedIds: ["a-1"],
		items: [todo(7, "a-1"), todo(7, "a-1")],
		scan: scan([issue("a-1", "repair the phase")]),
	});
	assert.deepEqual(result.linked[0].todoIds, ["7"]);
});

test("an issue that nobody authorized is never work", () => {
	const result = reconcileRequestIssues({
		authorizedIds: ["a-1"],
		items: [todo(7, "b-2")],
		scan: scan([issue("a-1", "repair the phase"), issue("b-2", "other")]),
	});
	// The issue of the todo is not authorized by the request, so it is not
	// linked and it does not become work of the request.
	assert.deepEqual(result.linked, []);
	assert.deepEqual(result.outstanding, ["a-1"]);
	assert.deepEqual(result.closed, []);
});

test("an authorized issue that the backlog reports as closed is done", () => {
	const result = reconcileRequestIssues({
		authorizedIds: ["a-1"],
		items: [],
		scan: scan([issue("a-1", "repair the phase", { status: "closed" })]),
	});
	assert.deepEqual(result.outstanding, []);
	assert.deepEqual(result.closed, ["a-1"]);
});

test("a backlog that cannot be read leaves the authorized work unknown", () => {
	const result = reconcileRequestIssues({
		authorizedIds: ["a-1"],
		items: [],
		scan: { available: false, issues: [], reason: "bd is not reachable" },
	});
	assert.equal(result.available, false);
	assert.equal(result.reason, "bd is not reachable");
	// The work is unknown, not done: the issue stays outstanding.
	assert.deepEqual(result.outstanding, ["a-1"]);
	assert.deepEqual(result.closed, []);
});

test("the ids of the request are deduplicated", () => {
	const result = reconcileRequestIssues({
		authorizedIds: ["a-1", " a-1 ", "", "b-2"],
		items: [],
		scan: scan([issue("a-1", "one"), issue("b-2", "two")]),
	});
	assert.deepEqual(result.authorized, ["a-1", "b-2"]);
	assert.deepEqual(result.outstanding, ["a-1", "b-2"]);
});

test("the tracker keeps the authorization of every request apart", () => {
	const tracker = new RequestIssueTracker();
	tracker.authorize(1, ["a-1"]);
	tracker.authorize(2, ["b-2"]);
	assert.deepEqual(tracker.authorizedFor(1), ["a-1"]);
	assert.deepEqual(tracker.authorizedFor(2), ["b-2"]);
	// A second group of the same request is added to the first one.
	tracker.authorize(2, ["c-3"]);
	assert.deepEqual(tracker.authorizedFor(2), ["b-2", "c-3"]);
	// The request that ends forgets its issues.
	tracker.forget(2);
	assert.deepEqual(tracker.authorizedFor(2), []);
	assert.deepEqual(tracker.authorizedFor(1), ["a-1"]);
});

test("a request with an outstanding authorized issue is not finished", () => {
	const view = readRequestWork({
		available: true,
		items: [{ id: 1, status: "completed" }],
		ownItems: [{ id: 1, status: "completed" }],
		authorizedIssues: ["a-1"],
		authorizedOutstanding: ["a-1"],
		authorizedAvailability: "available",
	});
	assert.equal(view.work, "unfinished");
	assert.match(view.reason, /authorized issue/);
});

test("a request whose backlog cannot be read is not finished", () => {
	const view = readRequestWork({
		available: true,
		items: [{ id: 1, status: "completed" }],
		ownItems: [{ id: 1, status: "completed" }],
		authorizedIssues: ["a-1"],
		authorizedOutstanding: ["a-1"],
		authorizedAvailability: "unknown",
	});
	assert.equal(view.work, "unknown");
});

test("a request without authorized issues is not held back by the backlog", () => {
	const view = readRequestWork({
		available: true,
		items: [{ id: 1, status: "completed" }],
		ownItems: [{ id: 1, status: "completed" }],
		authorizedIssues: [],
		authorizedOutstanding: [],
		authorizedAvailability: "unknown",
	});
	assert.equal(view.work, "complete");
});
