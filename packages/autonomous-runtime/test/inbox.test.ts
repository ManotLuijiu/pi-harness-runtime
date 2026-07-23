/**
 * Tests for TaskInbox (filesystem-backed).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskInbox } from "../src/inbox.js";

const DIR = mkdtempSync(join(tmpdir(), "pi-inbox-test-"));

// Set env so inbox uses our temp dir
process.env.PI_HARNESS_RUNTIME_ROOT = DIR;

const inbox = new TaskInbox({ rootDir: DIR });

afterEach(async () => {
	await inbox.clear?.();
});

afterAll(() => {
	try { rmSync(DIR, { recursive: true }); } catch { /* ignore */ }
});

describe("TaskInbox.submit", () => {
	it("accepts and returns a pending task", async () => {
		const spec = {
			id: "test-1",
			kind: "once" as const,
			priority: 5,
			spec: {},
		};
		const record = await inbox.submit(spec);
		expect(record.id).toBe("test-1");
		expect(record.status).toBe("pending");
		expect(record.submittedAt).toBeDefined();
	});

	it("rejects duplicate ids", async () => {
		const spec = {
			id: "dup-test",
			kind: "once" as const,
			priority: 5,
			spec: {},
		};
		await inbox.submit(spec);
		await expect(inbox.submit(spec)).rejects.toThrow();
	});
});

describe("TaskInbox.list", () => {
	it("returns all submitted tasks", async () => {
		await inbox.submit({ id: "l1", kind: "once", priority: 1, spec: {} });
		await inbox.submit({ id: "l2", kind: "once", priority: 2, spec: {} });
		const records = await inbox.list();
		expect(records.length).toBeGreaterThanOrEqual(2);
	});

	it("filters by status", async () => {
		await inbox.submit({ id: "f1", kind: "once", priority: 1, spec: {} });
		const pending = await inbox.list({ status: "pending" });
		expect(pending.every((r) => r.status === "pending")).toBe(true);
	});
});

describe("TaskInbox.claim", () => {
	it("returns null when nothing is pending", async () => {
		const lease = await inbox.claim({ workerId: "w1", heartbeatIntervalMs: 30_000 });
		expect(lease).toBeNull();
	});

	it("returns a lease for a pending task", async () => {
		await inbox.submit({ id: "claim-1", kind: "once", priority: 5, spec: {} });
		const lease = await inbox.claim({ workerId: "w1", heartbeatIntervalMs: 30_000 });
		expect(lease).not.toBeNull();
		expect(lease!.taskId).toBe("claim-1");
		expect(lease!.status).toBe("active");
	});
});
