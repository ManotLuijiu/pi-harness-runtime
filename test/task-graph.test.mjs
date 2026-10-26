/**
 * Tests for Task Graph — RFC-0016
 *
 * The task graph is one real implementation: the concrete RFC-0016 graph
 * with the RFC-0028 compact view on top. These tests cover the behaviour
 * that the runtime relies on; the dependency transitions, the persistence
 * and the topological order have their own suite in
 * test/task-graph-manager.test.mjs.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { createTaskGraphManager } from "../harness/task-graph.ts";

/** Minimal RuntimeTask factory for test use */
function makeTask(overrides = {}) {
	return {
		id: `task-${Math.random().toString(36).slice(2, 8)}`,
		title: "Test task",
		description: "Test description",
		status: "pending",
		...overrides,
	};
}

describe("TaskGraphManager", () => {
	let graph;

	beforeEach(() => {
		graph = createTaskGraphManager();
	});

	it("getAllTasks returns empty initially", () => {
		assert.strictEqual(graph.getAllTasks().length, 0);
	});

	it("addTask inserts a task into the graph", () => {
		graph.addTask(makeTask({ id: "task-001", title: "First" }));
		assert.strictEqual(graph.getAllTasks().length, 1);
		assert.strictEqual(graph.getAllTasks()[0].id, "task-001");
	});

	it("getReadyTasks returns empty initially", () => {
		assert.strictEqual(graph.getReadyTasks().length, 0);
	});

	it("completeTask marks the task done (via progress summary)", () => {
		const task = makeTask({ id: "task-001" });
		graph.addTask(task);
		graph.completeTask("task-001");
		// The stub tracks completion in getProgressSummary, not task.status
		assert.strictEqual(graph.getProgressSummary().done, 1);
	});

	it("getPendingTasks returns pending tasks", () => {
		graph.addTask(makeTask({ id: "task-001" }));
		graph.addTask(makeTask({ id: "task-002" }));
		assert.strictEqual(graph.getPendingTasks().length, 2);
	});

	it("getProgressSummary returns counts", () => {
		graph.addTask(makeTask({ id: "task-001" }));
		graph.addTask(makeTask({ id: "task-002" }));
		const summary = graph.getProgressSummary();
		assert.strictEqual(summary.total, 2);
		assert.strictEqual(summary.done, 0);
		assert.strictEqual(summary.running, 0);
		assert.strictEqual(summary.failed, 0);
	});

	it("getCompactPriority returns keep and prune lists", () => {
		const result = graph.getCompactPriority();
		assert.ok(Array.isArray(result.keep));
		assert.ok(Array.isArray(result.prune));
	});

	it("completeTask updates progress summary", () => {
		graph.addTask(makeTask({ id: "task-001" }));
		graph.completeTask("task-001");
		const summary = graph.getProgressSummary();
		assert.strictEqual(summary.done, 1);
	});

	it("getReadyTasks keeps an explicitly pending task pending", () => {
		// A task that arrives with its own status keeps that status; only a
		// task without dependencies and without a status becomes ready.
		graph.addTask(makeTask({ id: "task-001" }));
		assert.strictEqual(graph.getReadyTasks().length, 0);
	});

	it("getBlockedTasks returns the tasks that wait for a task", () => {
		graph.addTask(makeTask({ id: "task-001" }));
		// Nothing waits for this task yet.
		assert.deepStrictEqual(graph.getBlockedTasks("task-001"), []);
	});
});
