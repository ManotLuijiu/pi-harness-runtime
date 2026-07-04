/**
 * Tests for Task Graph — RFC-0016
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

const { TaskGraphManager } = await import("../harness/task-graph.ts");

describe("TaskGraphManager", () => {
	let graph;

	beforeEach(() => {
		graph = new TaskGraphManager({ jobId: "job-001" });
	});

	it("adds a task with no dependencies as ready", () => {
		const task = graph.addTask("task-001", "First task", "Description");
		assert.strictEqual(task.status, "ready");
		assert.deepStrictEqual(task.dependencies, []);
	});

	it("adds a task with dependencies as pending", () => {
		graph.addTask("task-001", "First task", "Description");
		const task = graph.addTask("task-002", "Second task", "Description", [
			"task-001",
		]);
		assert.strictEqual(task.status, "pending");
	});

	it("updates task status", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.updateTaskStatus("task-001", "done");
		assert.strictEqual(graph.getTask("task-001")?.status, "done");
	});

	it("marks dependent tasks as ready when dependencies complete", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.addTask("task-002", "Second task", "Description", ["task-001"]);
		assert.strictEqual(graph.getTask("task-002")?.status, "pending");

		graph.updateTaskStatus("task-001", "done");
		assert.strictEqual(graph.getTask("task-002")?.status, "ready");
	});

	it("getReadyTasks returns only ready tasks", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.addTask("task-002", "Second task", "Description", ["task-001"]);
		graph.addTask("task-003", "Third task", "Description", ["task-001"]);

		assert.strictEqual(graph.getReadyTasks().length, 1);

		graph.updateTaskStatus("task-001", "done");
		assert.strictEqual(graph.getReadyTasks().length, 2);
	});

	it("isComplete returns true when all tasks done", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.addTask("task-002", "Second task", "Description");
		graph.updateTaskStatus("task-001", "done");
		assert.strictEqual(graph.isComplete(), false);
		graph.updateTaskStatus("task-002", "done");
		assert.strictEqual(graph.isComplete(), true);
	});

	it("hasFailedTasks returns true when any task fails", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.updateTaskStatus("task-001", "failed");
		assert.strictEqual(graph.hasFailedTasks(), true);
	});

	it("increments retry count", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.incrementRetry("task-001");
		assert.strictEqual(graph.getTask("task-001")?.retryCount, 1);
		graph.incrementRetry("task-001");
		assert.strictEqual(graph.getTask("task-001")?.retryCount, 2);
	});

	it("assigns agent to task", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.assignAgent("task-001", "agent-001", "/path/to/worktree");
		const task = graph.getTask("task-001");
		assert.strictEqual(task?.assignedAgent, "agent-001");
		assert.strictEqual(task?.worktreePath, "/path/to/worktree");
	});

	it("unassigns agent from task", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.assignAgent("task-001", "agent-001");
		graph.unassignAgent("task-001");
		const task = graph.getTask("task-001");
		assert.strictEqual(task?.assignedAgent, undefined);
	});

	it("canRetry respects maxRetries", () => {
		graph.addTask("task-001", "First task", "Description");
		assert.strictEqual(graph.canRetry("task-001"), true);
		graph.incrementRetry("task-001");
		graph.incrementRetry("task-001");
		graph.incrementRetry("task-001");
		assert.strictEqual(graph.canRetry("task-001"), false);
	});

	it("getProgressSummary returns correct counts", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.addTask("task-002", "Second task", "Description");
		graph.addTask("task-003", "Third task", "Description");
		graph.updateTaskStatus("task-001", "done");
		graph.updateTaskStatus("task-002", "running");

		const summary = graph.getProgressSummary();
		assert.strictEqual(summary.total, 3);
		assert.strictEqual(summary.done, 1);
		assert.strictEqual(summary.running, 1);
		assert.strictEqual(summary.pending, 1);
		assert.strictEqual(summary.failed, 0);
	});

	it("topologicalOrder respects dependencies", () => {
		graph.addTask("task-001", "First", "Description");
		graph.addTask("task-002", "Second", "Description", ["task-001"]);
		graph.addTask("task-003", "Third", "Description", ["task-002"]);

		const order = graph.getTopologicalOrder();
		const i1 = order.indexOf("task-001");
		const i2 = order.indexOf("task-002");
		const i3 = order.indexOf("task-003");

		assert.ok(i1 < i2, "task-001 should come before task-002");
		assert.ok(i2 < i3, "task-002 should come before task-003");
	});

	it("throws on duplicate task ID", () => {
		graph.addTask("task-001", "First task", "Description");
		assert.throws(() => {
			graph.addTask("task-001", "Duplicate task", "Description");
		}, /already exists/);
	});

	it("getAllTasks returns all tasks", () => {
		graph.addTask("task-001", "First task", "Description");
		graph.addTask("task-002", "Second task", "Description");
		const tasks = graph.getAllTasks();
		assert.strictEqual(tasks.length, 2);
	});

	it("getTask returns null for unknown task", () => {
		assert.strictEqual(graph.getTask("unknown"), null);
	});
});
