/**
 * Tests for Repair Engine — RFC-0018
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

const { RepairEngine } = await import("../harness/repair-engine.ts");

describe("RepairEngine", () => {
	let engine;

	beforeEach(() => {
		engine = new RepairEngine("/tmp/harness-test");
	});

	it("classifies test_failure from error message", () => {
		const type = engine.classifyFailure("Test failed: expected 1 but got 2");
		assert.strictEqual(type, "test_failure");
	});

	it("classifies TypeError as type_error", () => {
		const type = engine.classifyFailure(
			"TypeError: Cannot read property 'foo'",
		);
		assert.strictEqual(type, "type_error");
	});

	it("classifies quota exhaustion", () => {
		const type = engine.classifyFailure(
			"Rate limit exceeded. Retry after 5 minutes",
		);
		assert.strictEqual(type, "quota_exhausted");
	});

	it("classifies build errors", () => {
		const type = engine.classifyFailure("Build failed: SyntaxError at line 42");
		assert.strictEqual(type, "build_error");
	});

	it("classifies lint errors", () => {
		const type = engine.classifyFailure("ESLint: Missing semicolon");
		assert.strictEqual(type, "lint_error");
	});

	it("classifies unknown as default", () => {
		const type = engine.classifyFailure("Something went wrong");
		assert.strictEqual(type, "unknown");
	});

	it("creates repair task with default retry policy", () => {
		const task = engine.createRepairTask(
			"task-001",
			"test_failure",
			"Test failed",
		);
		assert.strictEqual(task.originalTaskId, "task-001");
		assert.strictEqual(task.failureType, "test_failure");
		assert.strictEqual(task.status, "pending");
		assert.strictEqual(task.retryPolicy.maxRetries, 3);
		assert.strictEqual(task.retryPolicy.backoffMs, 5000);
	});

	it("creates repair task with custom retry policy", () => {
		const task = engine.createRepairTask(
			"task-001",
			"test_failure",
			"Test failed",
			{
				retryPolicy: { maxRetries: 5, backoffMs: 1000, backoffMultiplier: 3 },
			},
		);
		assert.strictEqual(task.retryPolicy.maxRetries, 5);
		assert.strictEqual(task.retryPolicy.backoffMs, 1000);
	});

	it("records failed attempt", () => {
		const task = engine.createRepairTask(
			"task-001",
			"test_failure",
			"Test failed",
		);
		engine.recordAttempt(task.id, "Attempt 1: Fixed test", false);
		assert.strictEqual(task.attemptedFixes.length, 1);
		assert.strictEqual(task.attemptedFixes[0].success, false);
		assert.strictEqual(task.status, "pending");
	});

	it("marks as resolved on successful fix", () => {
		const task = engine.createRepairTask(
			"task-001",
			"test_failure",
			"Test failed",
		);
		engine.recordAttempt(task.id, "Fixed the bug", true);
		assert.strictEqual(task.status, "resolved");
		assert.ok(task.resolvedAt);
	});

	it("escalates after max retries", () => {
		const task = engine.createRepairTask(
			"task-001",
			"test_failure",
			"Test failed",
		);
		// Max retries is 3 by default
		engine.recordAttempt(task.id, "Attempt 1", false);
		engine.recordAttempt(task.id, "Attempt 2", false);
		engine.recordAttempt(task.id, "Attempt 3", false);
		assert.strictEqual(task.status, "escalated");
	});

	it("calculates next retry delay with exponential backoff", () => {
		const task = engine.createRepairTask(
			"task-001",
			"test_failure",
			"Test failed",
		);
		engine.recordAttempt(task.id, "Attempt 1", false);
		const delay = engine.getNextRetryDelay(task.id);
		assert.strictEqual(delay, 10000); // 5000 * 2^1
	});

	it("analyzeAndRepair returns guidance", () => {
		const { repairTask, guidance } = engine.analyzeAndRepair(
			"task-001",
			"Test failed: assertion error",
		);
		assert.ok(guidance.length > 0);
		assert.ok(guidance.includes("test"));
		assert.strictEqual(repairTask.failureType, "test_failure");
	});

	it("exportReport generates summary", () => {
		engine.createRepairTask("task-001", "test_failure", "Test failed");
		const report = engine.exportReport("unknown-job");
		assert.ok(report.includes("Repair Report"));
	});

	it("getSummary returns correct counts", () => {
		// Tasks are filtered by job ID, so this tests basic structure
		const summary = engine.getSummary("unknown-job");
		assert.ok("total" in summary);
		assert.ok("pending" in summary);
		assert.ok("resolved" in summary);
		assert.ok("escalated" in summary);
	});
});
