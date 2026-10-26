/**
 * The unified task graph manager.
 *
 * RFC-0016 owns the dependency graph, RFC-0028 added a compact view. Both
 * now live in one implementation, and this suite holds the behaviour that the
 * two RFCs describe: the dependency transitions, the topological order, the
 * persistence and the compact priority.
 *
 * The suite runs under bun and under node, so it uses node:test and the
 * literal ".ts" specifier that node's type stripping resolves.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskGraphManager } from "../harness/task-graph.ts";

describe("TaskGraphManager - dependency transitions", () => {
	it("marks a task without dependencies as ready", () => {
		const manager = new TaskGraphManager({ jobId: "job-1" });
		manager.addTask("a", "First", "does the first thing");

		assert.equal(manager.getTask("a")?.status, "ready");
		assert.equal(manager.getReadyTasks().length, 1);
		assert.equal(manager.getPendingTasks().length, 0);
	});

	it("holds a task with an open dependency in pending", () => {
		const manager = new TaskGraphManager({ jobId: "job-1" });
		manager.addTask("a", "First", "does the first thing");
		manager.addTask("b", "Second", "needs the first", ["a"]);

		assert.equal(manager.getTask("b")?.status, "pending");
		assert.equal(manager.getReadyTasks().length, 1);
		assert.equal(manager.getBlockedTasks("a").length, 1);
		assert.equal(manager.getBlockedTasks("a")[0].id, "b");
	});

	it("releases a dependent when its dependency is done", () => {
		const manager = new TaskGraphManager({ jobId: "job-1" });
		manager.addTask("a", "First", "does the first thing");
		manager.addTask("b", "Second", "needs the first", ["a"]);

		manager.completeTask("a");

		assert.equal(manager.getTask("a")?.status, "done");
		assert.equal(manager.getTask("b")?.status, "ready");
		assert.equal(manager.getBlockedTasks("a").length, 0);
	});

	it("keeps a dependent pending while another dependency is open", () => {
		const manager = new TaskGraphManager({ jobId: "job-1" });
		manager.addTask("a", "First", "does the first thing");
		manager.addTask("b", "Second", "does the second thing");
		manager.addTask("c", "Third", "needs both", ["a", "b"]);

		manager.completeTask("a");
		assert.equal(manager.getTask("c")?.status, "pending");

		manager.completeTask("b");
		assert.equal(manager.getTask("c")?.status, "ready");
	});

	it("refuses a duplicate task id", () => {
		const manager = new TaskGraphManager({ jobId: "job-1" });
		manager.addTask("a", "First", "does the first thing");
		assert.throws(() => manager.addTask("a", "Again", "again"), /already exists/);
	});

	it("counts the progress of the graph", () => {
		const manager = new TaskGraphManager({ jobId: "job-1" });
		manager.addTask("a", "First", "does the first thing");
		manager.addTask("b", "Second", "needs the first", ["a"]);
		manager.completeTask("a");
		manager.updateTaskStatus("b", "running");

		const progress = manager.getProgressSummary();
		assert.equal(progress.total, 2);
		assert.equal(progress.done, 1);
		assert.equal(progress.running, 1);
		assert.equal(progress.failed, 0);
	});
});

describe("TaskGraphManager - topological order", () => {
	it("orders the tasks by their dependencies", () => {
		const manager = new TaskGraphManager({ jobId: "job-1" });
		manager.addTask("c", "Third", "needs the second", ["b"]);
		manager.addTask("a", "First", "does the first thing");
		manager.addTask("b", "Second", "needs the first", ["a"]);

		assert.deepEqual(manager.getTopologicalOrder(), ["a", "b", "c"]);
	});

	it("keeps the dependents of a task in the graph", () => {
		const manager = new TaskGraphManager({ jobId: "job-1" });
		manager.addTask("a", "First", "does the first thing");
		manager.addTask("b", "Second", "needs the first", ["a"]);

		assert.deepEqual(manager.getTask("a")?.dependents, ["b"]);
		assert.deepEqual(manager.getTask("b")?.dependencies, ["a"]);
	});
});

describe("TaskGraphManager - compact priority", () => {
	it("keeps the done tasks and prunes the pending ones", () => {
		const manager = new TaskGraphManager({ jobId: "job-1" });
		manager.addTask("a", "First", "does the first thing");
		manager.addTask("b", "Second", "needs the first", ["a"]);
		manager.completeTask("a");

		const priority = manager.getCompactPriority();
		assert.deepEqual(priority.keep, ["a"]);
		assert.deepEqual(priority.prune, []);
	});
});

describe("TaskGraphManager - persistence", () => {
	let rootDir;

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "task-graph-test-"));
	});

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true });
	});

	it("writes the graph under the job directory", async () => {
		const manager = new TaskGraphManager({ jobId: "job-42" });
		manager.addTask("a", "First", "does the first thing");
		await manager.save(rootDir);

		const path = join(rootDir, "jobs", "job-42", "task-graph.json");
		assert.ok(existsSync(path), "the graph file should exist");
		const saved = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(saved.jobId, "job-42");
		assert.equal(Object.keys(saved.nodes).length, 1);
	});

	it("loads a saved graph again", async () => {
		const manager = new TaskGraphManager({ jobId: "job-42" });
		manager.addTask("a", "First", "does the first thing");
		manager.addTask("b", "Second", "needs the first", ["a"]);
		await manager.save(rootDir);

		const loaded = await TaskGraphManager.load("job-42", rootDir);
		assert.equal(loaded.getAllTasks().length, 2);
		assert.equal(loaded.getTask("b")?.status, "pending");
		assert.deepEqual(loaded.getTopologicalOrder(), ["a", "b"]);
	});

	it("tracks the unsaved state", async () => {
		const manager = new TaskGraphManager({ jobId: "job-42" });
		assert.equal(manager.isDirty(), false);
		manager.addTask("a", "First", "does the first thing");
		assert.equal(manager.isDirty(), true);
		await manager.save(rootDir);
		assert.equal(manager.isDirty(), false);
	});
});

describe("TaskGraphManager - a planned graph", () => {
	it("wraps an existing graph", () => {
		const planner = new TaskGraphManager({ jobId: "job-7" });
		planner.addTask("a", "First", "does the first thing");
		planner.addTask("b", "Second", "needs the first", ["a"]);

		const manager = TaskGraphManager.fromGraph(planner.getGraph());
		assert.equal(manager.getAllTasks().length, 2);
		assert.equal(manager.getTask("b")?.status, "pending");
	});
});
