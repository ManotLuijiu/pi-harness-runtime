/**
 * The status of the task list of the session.
 *
 * An agent that stopped is not an agent that completed the request: the
 * status says what was observed and never what it guesses.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	TaskTrackingStatusController,
	openTodos,
	taskTrackingStatus,
} from "../harness/task-tracking-status.ts";

/**
 * A todo of the request.
 */
function todo(subject, status = "pending") {
	return { subject, status };
}

test("a running agent without todos says that the todos are missing", () => {
	const status = taskTrackingStatus({ running: true, todos: [] });
	assert.equal(status.key, "working-no-todos");
	assert.equal(status.text, "[TASK] Working - no Todos yet");
});

test("a settled agent without todos does not claim a completion", () => {
	const status = taskTrackingStatus({ running: false, todos: [] });
	assert.equal(status.key, "stopped-no-todos");
	assert.equal(status.text, "[TASK] Stopped - completion unverified; no Todos");
	assert.doesNotMatch(status.text, /done|complete\b(?!.*unverified)/);
});

test("a list that cannot be read is not an empty list", () => {
	const status = taskTrackingStatus({ running: false, todos: undefined });
	assert.equal(status.key, "todos-unavailable");
	assert.equal(status.text, "[TASK] Todos unavailable - completion unverified");
});

test("the open todos of the request are counted", () => {
	const status = taskTrackingStatus({
		running: true,
		todos: [todo("one"), todo("two", "in_progress"), todo("done", "completed")],
	});
	assert.equal(status.key, "working-open");
	assert.equal(status.text, "[TASK] Working - 2 open Todos");
});

test("a settled agent with open todos says that the work remains", () => {
	const status = taskTrackingStatus({ running: false, todos: [todo("one")] });
	assert.equal(status.key, "stopped-open");
	assert.equal(status.text, "[TASK] Stopped - 1 open Todos remain");
});

test("a pending validation is named instead of a completion", () => {
	const status = taskTrackingStatus({
		running: false,
		todos: [todo("one", "completed")],
		validationPending: true,
	});
	assert.match(status.text, /validation pending/);
	assert.match(status.text, /completion unverified/);
});

test("the finished todos of an earlier request are not open work", () => {
	assert.deepEqual(openTodos([todo("done", "completed")]), []);
	assert.deepEqual(openTodos(undefined), []);
});

test("the controller follows the agent and the list", () => {
	const controller = new TaskTrackingStatusController();
	controller.agentStarted();
	controller.stateChanged([todo("the work")]);
	assert.equal(controller.status().key, "working-open");
	controller.agentSettled();
	assert.equal(controller.status().key, "stopped-open");
	controller.stateChanged([]);
	assert.equal(controller.status().key, "stopped-no-todos");
});

test("a late read does not overwrite a newer state", async () => {
	const controller = new TaskTrackingStatusController();
	controller.agentStarted();
	let release = () => {};
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const read = controller.refresh(async () => {
		await gate;
		return [todo("the work of the old request")];
	});
	// The session moved on while the read was in flight.
	controller.agentSettled();
	controller.stateChanged([]);
	release();
	await read;
	assert.equal(controller.status().key, "stopped-no-todos");
});

test("a failed read leaves the list unavailable", async () => {
	const controller = new TaskTrackingStatusController();
	controller.agentStarted();
	await controller.refresh(async () => {
		throw new Error("unreadable");
	});
	assert.equal(controller.status().key, "todos-unavailable");
});

test("the controller forgets everything when the session is replaced", () => {
	const controller = new TaskTrackingStatusController();
	controller.agentStarted();
	controller.stateChanged([todo("the work")]);
	controller.reset();
	assert.equal(controller.status(), undefined);
});

test("the row stays away until the task list was read", () => {
	const controller = new TaskTrackingStatusController();
	controller.agentStarted();
	assert.equal(controller.status(), undefined);
});
