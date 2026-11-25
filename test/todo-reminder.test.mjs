/**
 * The reminder that asks the agent to record its work in the task list.
 *
 * The reminder is occasional: a nudge in every turn is noise. The module
 * decides whether the reminder is due, the session decides when to check.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	TODO_REMINDER_COOLDOWN_MS,
	decideTodoReminder,
	openTodos,
	todoReminderText,
	workIsTracked,
} from "../harness/todo-reminder.ts";

/**
 * A todo of the session.
 */
function todo(subject, status = "pending") {
	return { subject, status };
}

test("the reminder is due when the work of the session is not in the list", () => {
	const decision = decideTodoReminder({
		todos: [],
		occasion: "compaction",
		now: 1_000,
	});
	assert.equal(decision.remind, true);
	assert.match(decision.reason, /not in the task list/);
	assert.ok(decision.text);
});

test("the reminder stays away when the work is already tracked", () => {
	const decision = decideTodoReminder({
		todos: [todo("the work of the request")],
		occasion: "compaction",
		now: 1_000,
	});
	assert.equal(decision.remind, false);
	assert.match(decision.reason, /already in the task list/);
	assert.equal(decision.text, undefined);
});

test("the reminder stays away when the task list cannot be read", () => {
	const decision = decideTodoReminder({
		todos: undefined,
		occasion: "context-pressure",
		now: 1_000,
	});
	assert.equal(decision.remind, false);
	assert.match(decision.reason, /cannot be read/);
	assert.equal(decision.text, undefined);
});

test("the reminder waits for its pause", () => {
	const now = 1_000_000;
	const decision = decideTodoReminder({
		todos: [],
		occasion: "session",
		lastReminderAt: now - TODO_REMINDER_COOLDOWN_MS + 1,
		now,
	});
	assert.equal(decision.remind, false);
	assert.match(decision.reason, /recently/);
});

test("the reminder goes out again after its pause", () => {
	const now = 1_000_000;
	const decision = decideTodoReminder({
		todos: [],
		occasion: "session",
		lastReminderAt: now - TODO_REMINDER_COOLDOWN_MS,
		now,
	});
	assert.equal(decision.remind, true);
});

test("a finished todo does not count as tracked work", () => {
	const todos = [todo("the work of the request", "completed")];
	assert.deepEqual(openTodos(todos), []);
	assert.equal(workIsTracked(todos), false);
	assert.equal(workIsTracked([todo("the work", "in_progress")]), true);
});

test("one open todo does not hide the steps that have no item", () => {
	// The request asks for three steps, and the agent recorded one of
	// them. The reminder has to stay alive for the other two.
	const decision = decideTodoReminder({
		todos: [todo("Inspect the code of the parser", "in_progress")],
		requiredSteps: [
			"Inspect the code of the parser",
			"Add the missing tests of the parser",
			"Update the documentation of the parser",
		],
		requestText: "Inspect the code, add the missing tests, and update the documentation",
		occasion: "compaction",
		now: 1_000,
	});
	assert.equal(decision.remind, true);
	assert.match(decision.reason, /not in the task list/);
	// The reminder names the work that has no item.
	assert.match(decision.text, /missing tests/i);
	assert.match(decision.text, /documentation/i);
	// The reminder names the request the work belongs to.
	assert.match(decision.text, /Inspect the code, add the missing tests/);
});

test("the reminder stays away when every step of the request has an item", () => {
	const decision = decideTodoReminder({
		todos: [
			todo("Add the missing tests of the parser"),
			todo("Update the documentation of the parser"),
		],
		requiredSteps: [
			"Add the missing tests of the parser",
			"Update the documentation of the parser",
		],
		occasion: "compaction",
		now: 1_000,
	});
	assert.equal(decision.remind, false);
	assert.match(decision.reason, /every step of the request is in the task list/);
});

test("the steps of the request that are unknown keep the old decision", () => {
	// Without the steps of the request the list alone decides, as before.
	const decision = decideTodoReminder({
		todos: [todo("the work of the request")],
		occasion: "compaction",
		now: 1_000,
	});
	assert.equal(decision.remind, false);
	assert.match(decision.reason, /already in the task list/);
});

test("the text of the reminder names the task list and asks for the work", () => {
	const text = todoReminderText();
	assert.match(text, /task list/i);
	assert.match(text, /context window/i);
	assert.match(text, /Use todo \(the local Todos list, not bd\)/);
});
