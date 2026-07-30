/**
 * Autonomous Runtime — tests for Phase 1 (RFC-0101 §1-4)
 * Plain JS (bun native test globals)
 */
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskInbox } from "../src/index.js";
import { LeaseManager } from "../src/index.js";

let testDir;

function makeTask(overrides = {}) {
	const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	const now = new Date().toISOString();
	return {
		id,
		objective: `Test task ${id}`,
		acceptanceCriteria: ["criterion 1"],
		source: { kind: "manual", createdBy: "test" },
		priority: 2,
		capabilities: ["llm.invoke"],
		approvalClass: "automatic_read_only",
		status: "queued",
		attempts: 0,
		maxAttempts: 3,
		createdAt: now,
		updatedAt: now,
		history: [],
		...overrides,
	};
}

beforeEach(() => {
	testDir = join(
		tmpdir(),
		`pi-harness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(testDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

const tasksPath = () => join(testDir, "tasks.jsonl");
const leasesDir = () => join(testDir, "claimed");

// ─── TaskInbox ────────────────────────────────────────────────────────────────

describe("TaskInbox", () => {
	it("append writes one JSONL line", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		inbox.append(makeTask());
		const content = readFileSync(tasksPath(), "utf8");
		const lines = content.trim().split("\n").filter(Boolean);
		expect(lines).toHaveLength(1);
		expect(() => JSON.parse(lines[0])).not.toThrow();
	});

	it("append rejects duplicate ids", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		const task = makeTask();
		inbox.append(task);
		expect(() => inbox.append(task)).toThrow();
	});

	it("list returns tasks sorted by priority then createdAt", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		inbox.append(makeTask({ id: "a", priority: 1 }));
		inbox.append(makeTask({ id: "b", priority: 2 }));
		inbox.append(
			makeTask({
				id: "c",
				priority: 1,
				createdAt: new Date(Date.now() + 1000).toISOString(),
			}),
		);
		expect(inbox.list().map((t) => t.id)).toEqual(["a", "c", "b"]);
	});

	it("list filters by status", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		inbox.append(makeTask({ id: "queued-1", status: "queued" }));
		inbox.append(makeTask({ id: "running-1", status: "running" }));
		inbox.append(makeTask({ id: "completed-1", status: "completed" }));
		expect(inbox.list({ status: "queued" }).map((t) => t.id)).toEqual([
			"queued-1",
		]);
	});

	it("get returns a task by id", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		const task = makeTask({ id: "find-me" });
		inbox.append(task);
		expect(inbox.get("find-me")?.id).toBe("find-me");
		expect(inbox.get("not-found")).toBeNull();
	});

	it("transition updates status and appends history", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		const task = makeTask();
		inbox.append(task);
		const updated = inbox.transition(task.id, "running");
		expect(updated.status).toBe("running");
		expect(updated.history).toHaveLength(1);
		expect(updated.history[0].kind).toBe("transitioned");
	});

	it("transition throws for unknown tasks", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		expect(() => inbox.transition("does-not-exist", "running")).toThrow();
	});

	it("complete marks status and sets result", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		const task = makeTask();
		inbox.append(task);
		const result = {
			taskId: task.id,
			status: "completed",
			acceptanceCriteriaMet: [],
			durationMs: 1000,
		};
		const updated = inbox.complete(task.id, result);
		expect(updated.status).toBe("completed");
		expect(updated.result).toEqual(result);
	});

	it("fail increments attempts", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		const task = makeTask();
		inbox.append(task);
		const updated = inbox.fail(task.id, "Something went wrong");
		expect(updated.status).toBe("retrying");
		expect(updated.failureReason).toBe("Something went wrong");
		expect(updated.attempts).toBe(1);
	});

	it("fail promotes to dead_letter when maxAttempts reached", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		const task = makeTask({ attempts: 2, maxAttempts: 3 });
		inbox.append(task);
		const updated = inbox.fail(task.id, "Final failure");
		expect(updated.status).toBe("dead_letter");
		expect(updated.failureReason).toBe("Final failure");
	});

	it("stats returns counts by status", () => {
		const inbox = new TaskInbox({ tasksPath: tasksPath() });
		inbox.append(makeTask({ id: "a", status: "queued" }));
		inbox.append(makeTask({ id: "b", status: "queued" }));
		inbox.append(makeTask({ id: "c", status: "running" }));
		inbox.append(makeTask({ id: "d", status: "completed" }));
		const stats = inbox.stats();
		expect(stats["queued"]).toBe(2);
		expect(stats["running"]).toBe(1);
		expect(stats["completed"]).toBe(1);
	});
});

// ─── LeaseManager ─────────────────────────────────────────────────────────────

describe("LeaseManager", () => {
	it("claim writes a lease file atomically", () => {
		const lm = new LeaseManager({ leasesDir: leasesDir() });
		const lease = lm.claim("task-1", "worker-1");
		expect(lease).not.toBeNull();
		expect(lease.taskId).toBe("task-1");
		expect(lease.workerId).toBe("worker-1");
		expect(lease.attempt).toBe(1);
		expect(lease.acquiredAt).toBeTruthy();
		expect(lease.expiresAt).toBeTruthy();
	});

	it("claim returns null when already claimed by another worker", () => {
		const lm = new LeaseManager({ leasesDir: leasesDir() });
		// Worker-1 claims first, worker-2 tries immediately after.
		// Atomic rename guarantees only one succeeds.
		const first = lm.claim("task-1", "worker-1");
		expect(first).not.toBeNull();
		const second = lm.claim("task-1", "worker-2");
		expect(second).toBeNull();
	});

	it("heartbeat extends expiry", async () => {
		const lm = new LeaseManager({ leasesDir: leasesDir() });
		lm.claim("task-1", "worker-1");
		const before = new Date(lm.get("task-1").expiresAt).getTime();
		await new Promise((r) => setTimeout(r, 50));
		const refreshed = lm.heartbeat("task-1", "worker-1");
		expect(refreshed).not.toBeNull();
		const after = new Date(refreshed.expiresAt).getTime();
		expect(after).toBeGreaterThan(before - 500);
	});

	it("heartbeat rejects wrong worker", () => {
		const lm = new LeaseManager({ leasesDir: leasesDir() });
		lm.claim("task-1", "worker-1");
		expect(() => lm.heartbeat("task-1", "wrong-worker")).toThrow();
	});

	it("release removes the lease file", () => {
		const lm = new LeaseManager({ leasesDir: leasesDir() });
		lm.claim("task-1", "worker-1");
		lm.release("task-1", "worker-1");
		expect(lm.get("task-1")).toBeNull();
	});

	it("reapAndRelease removes expired leases", async () => {
		const lm = new LeaseManager({ leasesDir: leasesDir(), leaseTtlMs: 50 });
		lm.claim("task-1", "worker-1");
		lm.claim("task-2", "worker-2");
		await new Promise((r) => setTimeout(r, 80));
		const released = lm.reapAndRelease();
		expect(released).toContain("task-1");
		expect(lm.get("task-1")).toBeNull();
	});

	it("isExpired returns false for fresh leases", () => {
		const lm = new LeaseManager({ leasesDir: leasesDir() });
		const lease = lm.claim("task-1", "worker-1");
		expect(lm.isExpired(lease)).toBe(false);
	});

	it("isExpired returns true for expired leases", async () => {
		const lm = new LeaseManager({ leasesDir: leasesDir(), leaseTtlMs: 1 });
		lm.claim("task-1", "worker-1");
		await new Promise((r) => setTimeout(r, 20));
		expect(lm.isExpired(lm.get("task-1"))).toBe(true);
	});

	it("listActive returns only non-expired leases", async () => {
		const lm = new LeaseManager({ leasesDir: leasesDir(), leaseTtlMs: 50 });
		lm.claim("task-1", "worker-1");
		await new Promise((r) => setTimeout(r, 80));
		expect(lm.listActive()).toHaveLength(0);
	});

	it("recoverOnStartup releases orphan leases", async () => {
		const lm = new LeaseManager({ leasesDir: leasesDir(), leaseTtlMs: 50 });
		lm.claim("task-1", "worker-1");
		await new Promise((r) => setTimeout(r, 80));
		const released = lm.recoverOnStartup();
		expect(released).toContain("task-1");
	});
});

// ─── Storage paths ────────────────────────────────────────────────────────────

describe("Storage paths", () => {
	it("getInboxDir returns a path under the runtime root", async () => {
		const { getRuntimeRoot, getInboxDir } = await import("../src/types.js");
		expect(getInboxDir()).toContain(".pi/harness/inbox");
		expect(getInboxDir()).toContain(getRuntimeRoot());
	});

	it("getLeasesDir returns claimed/ subdirectory", async () => {
		const { getLeasesDir } = await import("../src/types.js");
		expect(getLeasesDir()).toContain("claimed");
	});
});
