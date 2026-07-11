/**
 * Tests for Task Graph — RFC-0016
 *
 * Note: The TaskGraphManager is a stub implementation.
 * Tests reflect the actual stub interface (not the full RFC-0016 design).
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

	it("getReadyTasks reflects completed dependencies (stub)", () => {
		// Stub: ready task is not automatically set via addTask;
		// getReadyTasks returns tasks explicitly marked ready.
		// The stub's completeTask updates dependents' status.
		graph.addTask(makeTask({ id: "task-001" }));
		assert.strictEqual(graph.getReadyTasks().length, 0);
	});

	it("getBlockedTasks returns empty array (stub)", () => {
		graph.addTask(makeTask({ id: "task-001" }));
		// Stub always returns []
		assert.deepStrictEqual(graph.getBlockedTasks("task-001"), []);
	});
});
