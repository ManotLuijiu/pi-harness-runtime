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

test("the text of the reminder names the task list and asks for the work", () => {
	const text = todoReminderText();
	assert.match(text, /task list/i);
	assert.match(text, /context window/i);
	assert.match(text, /Use todo \(the local Todos list, not bd\)/);
});
