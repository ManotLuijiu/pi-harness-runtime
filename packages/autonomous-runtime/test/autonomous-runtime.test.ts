/**
 * Tests for autonomous-runtime (RFC-0101 Phase 1)
 *
 * Covers: TaskRecord, TaskStatus, TaskLease, TaskInbox, LeaseManager
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { TaskRecord, TaskLease } from "../src/types.js";
import { TaskInbox, LeaseManager } from "../src/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "pi-autonomous-"));
const INBOX_DIR = join(TEST_DIR, "inbox");
const LEASE_DIR = join(TEST_DIR, "leases");

afterEach(() => {
	try {
		rmSync(TEST_DIR, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("TaskRecord types", () => {
	it("accepts valid task shape", () => {
		const task: TaskRecord = {
			id: "task-1",
			status: "pending",
			title: "Test task",
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			attempts: 0,
		};
		expect(task.id).toBe("task-1");
		expect(task.status).toBe("pending");
	});
});

describe("LeaseManager", () => {
	it("grants exclusive lease to first worker", async () => {
		const mgr = new LeaseManager({ leases_dir: LEASE_DIR });
		const lease = await mgr.acquire("task-1", "worker-1");
		expect(lease).not.toBeNull();
		expect(lease!.worker_id).toBe("worker-1");
		expect(lease!.task_id).toBe("task-1");
		expect(lease!.acquired_at).toBeTruthy();
	});

	it("denies lease to second worker", async () => {
		const mgr = new LeaseManager({ leases_dir: LEASE_DIR });
		await mgr.acquire("task-1", "worker-1");
		const second = await mgr.acquire("task-1", "worker-2");
		expect(second).toBeNull();
	});

	it("releases and allows re-acquisition", async () => {
		const mgr = new LeaseManager({ leases_dir: LEASE_DIR });
		await mgr.acquire("task-1", "worker-1");
		await mgr.release("task-1", "worker-1");
		const next = await mgr.acquire("task-1", "worker-2");
		expect(next).not.toBeNull();
		expect(next!.worker_id).toBe("worker-2");
	});

	it("only owner can release", async () => {
		const mgr = new LeaseManager({ leases_dir: LEASE_DIR });
		await mgr.acquire("task-1", "worker-1");
		const released = await mgr.release("task-1", "worker-2");
		expect(released).toBe(false);
	});

	it("renewLease extends expiry if owner", async () => {
		const mgr = new LeaseManager({ leases_dir: LEASE_DIR });
		await mgr.acquire("task-1", "worker-1");
		const renewed = await mgr.renewLease("task-1", "worker-1");
		expect(renewed).toBe(true);
	});

	it("renewLease fails for non-owner", async () => {
		const mgr = new LeaseManager({ leases_dir: LEASE_DIR });
		await mgr.acquire("task-1", "worker-1");
		const renewed = await mgr.renewLease("task-1", "worker-2");
		expect(renewed).toBe(false);
	});

	it("getLease returns current lease", async () => {
		const mgr = new LeaseManager({ leases_dir: LEASE_DIR });
		const lease = await mgr.acquire("task-1", "worker-1");
		const found = await mgr.getLease("task-1");
		expect(found).toEqual(lease);
	});

	it("expired lease allows re-acquisition", async () => {
		const mgr = new LeaseManager({ leases_dir: LEASE_DIR, default_ttl_ms: 1 });
		await mgr.acquire("task-1", "worker-1");
		// Wait for expiry
		await new Promise((r) => setTimeout(r, 10));
		const next = await mgr.acquire("task-1", "worker-2");
		expect(next).not.toBeNull();
		expect(next!.worker_id).toBe("worker-2");
	});
});

describe("TaskInbox", () => {
	it("accepts and returns pending tasks", async () => {
		const inbox = new TaskInbox({ inbox_dir: INBOX_DIR });
		await inbox.submit({
			title: "Do the thing",
			description: "A test task",
			capability: "read",
		});
		const tasks = await inbox.getPending();
		expect(tasks.length).toBe(1);
		expect(tasks[0].status).toBe("pending");
	});

	it("assigns sequential integer IDs", async () => {
		const inbox = new TaskInbox({ inbox_dir: INBOX_DIR });
		await inbox.submit({ title: "Task 1", capability: "read" });
		await inbox.submit({ title: "Task 2", capability: "read" });
		const tasks = await inbox.getPending();
		expect(tasks.length).toBe(2);
		expect(tasks[0].id).toMatch(/^\d+$/);
		expect(tasks[1].id).toMatch(/^\d+$/);
		expect(Number(tasks[0].id)).toBeLessThan(Number(tasks[1].id));
	});

	it("transitions pending → running → completed", async () => {
		const inbox = new TaskInbox({ inbox_dir: INBOX_DIR });
		await inbox.submit({ title: "Test", capability: "read" });

		const task = (await inbox.getPending())[0];
		const started = await inbox.start(task.id);
		expect(started.status).toBe("running");

		const completed = await inbox.complete(task.id, { success: true });
		expect(completed.status).toBe("completed");
	});

	it("fails a running task", async () => {
		const inbox = new TaskInbox({ inbox_dir: INBOX_DIR });
		await inbox.submit({ title: "Fail task", capability: "read" });
		const task = (await inbox.getPending())[0];
		await inbox.start(task.id);
		const failed = await inbox.fail(task.id, "Intentional test failure");
		expect(failed.status).toBe("failed");
		expect(failed.error).toBe("Intentional test failure");
	});

	it("retries a failed task if max_attempts not exceeded", async () => {
		const inbox = new TaskInbox({
			inbox_dir: INBOX_DIR,
			options: { max_attempts: 2 },
		});
		await inbox.submit({ title: "Retry task", capability: "read" });
		const task = (await inbox.getPending())[0];
		await inbox.start(task.id);
		await inbox.fail(task.id, "First attempt failed");
		const retried = (await inbox.getPending()).find((t) => t.id === task.id);
		expect(retried).not.toBeUndefined();
		expect(retried!.attempts).toBe(1);
	});

	it("does not retry if max_attempts exceeded", async () => {
		const inbox = new TaskInbox({
			inbox_dir: INBOX_DIR,
			options: { max_attempts: 1 },
		});
		await inbox.submit({ title: "No retry task", capability: "read" });
		const task = (await inbox.getPending())[0];
		await inbox.start(task.id);
		await inbox.fail(task.id, "Final failure");
		const retried = await inbox.getTask(task.id);
		expect(retried?.status).toBe("failed");
		expect(retried?.attempts).toBe(1);
	});

	it("getTask returns specific task by id", async () => {
		const inbox = new TaskInbox({ inbox_dir: INBOX_DIR });
		await inbox.submit({ title: "Specific task", capability: "read" });
		const [task] = await inbox.getPending();
		const found = await inbox.getTask(task.id);
		expect(found?.id).toBe(task.id);
	});

	it("returns null for non-existent task", async () => {
		const inbox = new TaskInbox({ inbox_dir: INBOX_DIR });
		const found = await inbox.getTask("nonexistent");
		expect(found).toBeNull();
	});
});
