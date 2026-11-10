/**
 * The scope of the request, and the todos of the requests that came before.
 *
 * The task list is the history of the session: the todos of a request that
 * was finished stay in it. A new request therefore inherits a list that is
 * already complete, and the completion of the old request says nothing
 * about the new one.
 *
 * The scope of the request keeps the two apart, without deleting anything:
 * the todos of the earlier request stay a record of what happened, and they
 * do not complete the request that is running.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	captureRequestScope,
	itemsOfRequest,
	RequestScopeTracker,
	touchedKeys,
} from "../harness/jev-request-scope.ts";
import {
	jevWaitEligibility,
	jevWaitRegistration,
	jevWorkContext,
	questionRelevance,
} from "../harness/jev-wait-eligibility.ts";
import { isQuestionOpen, mayContinue } from "../harness/pending-question-state.ts";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

/** The todos of a request that was finished. */
const finishedTodos = [
	{ id: 1, subject: "Implement login", status: "completed" },
	{ id: 2, subject: "Write the tests of the login", status: "completed" },
];

/**
 * A tracker over a list that the test controls.
 */
function createTracker(initial) {
	let items = initial;
	return {
		tracker: new RequestScopeTracker({
			readTodos: async () => items.map((item) => ({ ...item })),
		}),
		set(next) {
			items = next;
		},
	};
}

/**
 * A tracker over a list and a history that the test controls.
 *
 * The history is the state of the list after every change, the way the
 * branch of the session holds it.
 */
function createTrackerWithHistory(initial) {
	let items = initial;
	let history = [];
	return {
		tracker: new RequestScopeTracker({
			readTodos: async () => items.map((item) => ({ ...item })),
			readHistory: async () => history.map((entry) => ({
				items: entry.map((item) => ({ ...item })),
			})),
		}),
		/** A change of the list: the state after it is remembered. */
		change(next) {
			items = next;
			history.push(next.map((item) => ({ ...item })));
		},
	};
}

test("the todos of a finished request do not complete the next request", () => {
	const { tracker } = createTracker(finishedTodos);
	// The request of the human begins: the list still holds the todos of
	// the request that ran before it.
	tracker.begin();

	const scope = captureRequestScope(finishedTodos, 1);
	const work = jevWorkContext(finishedTodos, { scope });
	// There is no evidence about the request that is running: the todos of
	// the list belong to the request that finished them.
	assert.equal(work.work, "unknown");
	assert.deepEqual(work.scope, []);
});

test("a todo of the request is unfinished, and complete when it is done", () => {
	const scope = captureRequestScope(finishedTodos, 1);
	const withTodo = [...finishedTodos, { id: 3, subject: "Add the logout", status: "pending" }];
	const running = jevWorkContext(withTodo, { scope });
	assert.equal(running.work, "unfinished");
	// The scope of the request is the work it asked for.
	assert.deepEqual(running.scope, ["Add the logout"]);

	const done = [...finishedTodos, { id: 3, subject: "Add the logout", status: "completed" }];
	const finished = jevWorkContext(done, { scope });
	assert.equal(finished.work, "complete");
	assert.deepEqual(finished.scope, ["Add the logout"]);
});

test("a todo that the request reopened belongs to the request", () => {
	const scope = captureRequestScope(finishedTodos, 1);
	const reopened = [...finishedTodos, { id: 1, subject: "Implement login", status: "in_progress" }];
	const work = jevWorkContext(reopened, { scope });
	assert.equal(work.work, "unfinished");
	assert.deepEqual(work.scope, ["Implement login"]);
});

test("a todo that the request reopened and finished again belongs to the request", async () => {
	// The todo starts completed, the request reopens it and finishes it
	// again. The final state is the state it had before, so the list
	// alone cannot tell that the request worked on it. The history can:
	// the request did the work, and the work is complete.
	const { tracker, change } = createTrackerWithHistory(finishedTodos);
	tracker.begin();
	// The capture of the baseline is asynchronous: the request changes the
	// list after the list was read, the way the agent works after the
	// message of the human.
	await tracker.read();

	change([
		{ id: 1, subject: "Implement login", status: "in_progress" },
		{ id: 2, subject: "Write the tests of the login", status: "completed" },
	]);
	change(finishedTodos);

	const { scope, items } = await tracker.read();
	const work = jevWorkContext(items, { scope });
	assert.equal(work.work, "complete");
});

test("the history says what a change touched", () => {
	const history = [
		{ items: [{ id: 1, subject: "Implement login", status: "completed" }] },
		{ items: [{ id: 1, subject: "Implement login", status: "in_progress" }] },
		{ items: [{ id: 1, subject: "Implement login", status: "completed" }] },
	];
	const touched = touchedKeys(history, 0);
	assert.deepEqual([...touched], ["id:1"]);
});

test("the history of an earlier request does not touch the todos of this one", () => {
	const history = [
		{ items: [{ id: 1, subject: "Implement login", status: "pending" }] },
		{ items: [{ id: 1, subject: "Implement login", status: "completed" }] },
	];
	// The request began after the second state: nothing of the history is
	// a change of this request.
	const touched = touchedKeys(history, 2);
	assert.deepEqual([...touched], []);
});

test("an open todo of an earlier request is work that remains", () => {
	const open = [
		{ id: 1, subject: "Implement login", status: "completed" },
		{ id: 2, subject: "Write the tests of the login", status: "pending" },
	];
	const scope = captureRequestScope(open, 1);
	const work = jevWorkContext(open, { scope });
	assert.equal(work.work, "unfinished");
});

test("without a scope the whole list belongs to the request", () => {
	// The harness reads the list this way when it cannot tell the requests
	// apart: the old behavior stays.
	const work = jevWorkContext(finishedTodos);
	assert.equal(work.work, "complete");
	assert.deepEqual(work.scope, ["Implement login", "Write the tests of the login"]);
});

test("the scope of a request keeps the todos of the earlier request out", () => {
	const scope = captureRequestScope(finishedTodos, 1);
	const own = itemsOfRequest(finishedTodos, scope);
	assert.deepEqual(own, []);
	const added = itemsOfRequest(
		[...finishedTodos, { id: 3, subject: "Add the logout", status: "pending" }],
		scope,
	);
	assert.deepEqual(added.map((item) => item.id), [3]);
});

test("a pending validation of the request is work that remains", () => {
	const scope = captureRequestScope(finishedTodos, 1);
	const done = [...finishedTodos, { id: 3, subject: "Add the logout", status: "completed" }];
	const work = jevWorkContext(done, {
		scope,
		validationPending: (item) => item.id === 3,
	});
	assert.equal(work.work, "unfinished");
});

test("the tracker reads the list when the request begins", async () => {
	const { tracker, set } = createTracker(finishedTodos);
	tracker.begin();
	// The request works: the list grows while the request runs.
	set([...finishedTodos, { id: 3, subject: "Add the logout", status: "pending" }]);
	const read = await tracker.read();
	assert.ok(read.scope, "the request has a scope");
	assert.equal(read.scope.generation, 1);
	const work = jevWorkContext(read.items, { scope: read.scope });
	assert.equal(work.work, "unfinished");
	assert.deepEqual(work.scope, ["Add the logout"]);
});

test("a new request starts a new scope", async () => {
	const { tracker, set } = createTracker(finishedTodos);
	tracker.begin();
	set([...finishedTodos, { id: 3, subject: "Add the logout", status: "completed" }]);
	const first = await tracker.read();
	assert.equal(jevWorkContext(first.items, { scope: first.scope }).work, "complete");

	// The next request of the human: the todos of the request that ran
	// before it are history now.
	tracker.begin();
	const second = await tracker.read();
	assert.equal(second.scope.generation, 2);
	assert.equal(
		jevWorkContext(second.items, { scope: second.scope }).work,
		"unknown",
		"the completion of the earlier request is not the completion of this one",
	);
});

test("a history that cannot be read is not used", async () => {
	// The history could not be read when the request started, so the
	// changes of the request cannot be told from the changes of the
	// earlier requests. The history is not used at all: the list alone
	// decides, and a todo that the request reopened and finished again
	// stays a todo of the earlier request.
	let items = finishedTodos;
	let history = [];
	let historyFails = true;
	const tracker = new RequestScopeTracker({
		readTodos: async () => items.map((item) => ({ ...item })),
		readHistory: async () => {
			if (historyFails) throw new Error("the history is gone");
			return history.map((entry) => ({
				items: entry.map((item) => ({ ...item })),
			}));
		},
	});
	tracker.begin();
	await tracker.read();
	historyFails = false;
	items = [
		{ id: 1, subject: "Implement login", status: "in_progress" },
		{ id: 2, subject: "Write the tests of the login", status: "completed" },
	];
	history.push(items.map((item) => ({ ...item })));
	items = finishedTodos;
	history.push(items.map((item) => ({ ...item })));

	const { scope } = await tracker.read();
	assert.deepEqual([...(scope?.touched ?? [])], []);
});

test("a deleted todo is not work of the request", () => {
	// A deleted todo is not work: it cannot make the request unfinished,
	// and it is not work that the request owns.
	const items = [
		{ id: 1, subject: "Implement login", status: "completed" },
		{ id: 2, subject: "Write the tests of the login", status: "deleted" },
	];
	const scope = captureRequestScope(items, 1);
	const work = jevWorkContext(items, { scope });
	// The request owns nothing: the todo it could own was deleted, and a
	// deleted todo is not work. The state of the work is unknown, so the
	// request is not declared finished.
	assert.equal(work.work, "unknown");
	assert.deepEqual(work.scope, []);
});

test("a todo without an id belongs to the request that is running", () => {
	// Without an id the todo cannot be told apart from another one, so it
	// belongs to the request that is running.
	const items = [
		{ id: 1, subject: "Implement login", status: "completed" },
		{ subject: "Write the tests of the login", status: "pending" },
	];
	const scope = captureRequestScope(items, 1);
	const work = jevWorkContext(items, { scope });
	assert.equal(work.work, "unfinished");
	assert.deepEqual(work.scope, ["Write the tests of the login"]);
});

test("a pending validation of one of the todos of the request keeps the work unfinished", () => {
	// The request owns two todos and one of them waits for its final tier:
	// the work of the request is not done.
	const items = [
		{ id: 1, subject: "Implement login", status: "completed" },
		{ id: 2, subject: "Write the tests of the login", status: "completed" },
	];
	const scope = captureRequestScope([], 1);
	const work = jevWorkContext(items, {
		scope,
		validationPending: (item) => item.id === 2,
	});
	assert.equal(work.work, "unfinished");
	assert.deepEqual(work.scope, ["Implement login", "Write the tests of the login"]);
});

test("the scope of a previous session is dropped", async () => {
	const { tracker } = createTracker(finishedTodos);
	tracker.begin();
	await tracker.read();
	// The session ended: the todos of that session are its history.
	tracker.reset();
	const read = await tracker.read();
	assert.equal(read.scope, null);
	assert.deepEqual(read.items, finishedTodos);
});

test("a list that cannot be read is no evidence", async () => {
	const tracker = new RequestScopeTracker({
		readTodos: async () => {
			throw new Error("the list is gone");
		},
	});
	tracker.begin();
	const read = await tracker.read();
	assert.equal(read.items, null);
	assert.equal(read.scope, null);
});

test("the clarification of a new request stays registered and blocks the work", async () => {
	// The regression: the todos of the previous request were all finished,
	// the human submits a new request, and the agent asks a necessary
	// clarification before it created a todo of its own.
	const { tracker } = createTracker(finishedTodos);
	tracker.begin();
	const read = await tracker.read();
	const work = jevWorkContext(read.items, { scope: read.scope });
	assert.equal(work.work, "unknown");

	const relevance = questionRelevance({
		text: "Which identity provider should I use?",
		work: work.work,
		kind: "clarification",
	});
	assert.equal(relevance, "current-request");

	const registration = jevWaitRegistration({ relevance, work: work.work });
	assert.equal(
		registration.register,
		true,
		"the question of the new request is not moot",
	);

	// The question is open, so it holds the continuation.
	const question = { state: "pending" };
	assert.equal(isQuestionOpen(question), true);
	assert.equal(mayContinue({ waiting: false, questionOpen: isQuestionOpen(question) }), false);

	// The rules of the silence are the rules that were there before: an
	// unknown state of the work is never a completion.
	const eligibility = jevWaitEligibility({ relevance, work: work.work });
	assert.equal(eligibility.eligible, true);
});

test("the extension begins a request only for a message of the human", () => {
	// The boundary of the request: the input event of a message that the
	// harness itself sent carries the source `extension` and begins
	// nothing.
	assert.match(
		indexSource,
		/pi\.on\("input", \(event\) => \{\s*if \(event\.source === "extension"\) return;/,
		"the request begins only for a message of the human",
	);
	assert.match(
		indexSource,
		/requestScopeTracker\.begin\(\);/,
		"the boundary of the request begins the scope",
	);
});

test("the extension reads the work with the scope of the request", () => {
	assert.match(
		indexSource,
		/jevWorkContext\(read\.items, \{\s*scope: read\.scope,/,
		"the state of the work is read with the scope of the request",
	);
});

test("the live controller of the continuation is shared with the callbacks", () => {
	// Without the assignment every pause and every resume of the work was a
	// call on nothing.
	assert.match(
		indexSource,
		/sharedState\.todoContinuationController = todoContinuationController;/,
		"the callbacks reach the live controller",
	);
});
