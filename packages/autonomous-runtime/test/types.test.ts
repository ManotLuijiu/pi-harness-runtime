/// <reference types="bun-types" />
/**
 * Tests for autonomous-runtime types.
 */

import { describe, it, expect } from "bun:test";
import type {
	TaskStatus,
	TaskEvent,
	TaskRecord,
	TaskLease,
	WorkerHeartbeat,
} from "../src/types.js";

describe("TaskStatus", () => {
	it("has all expected values", () => {
		const values: TaskStatus[] = [
			"queued",
			"claimed",
			"running",
			"waiting_approval",
			"waiting_quota",
			"retrying",
			"completed",
			"failed",
			"dead_letter",
		];
		for (const v of values) {
			expect(typeof v).toBe("string");
		}
	});
});

describe("TaskEvent", () => {
	it("accepts a minimal valid event", () => {
		const event: TaskEvent = {
			ts: new Date().toISOString(),
			kind: "started",
		};
		expect(event.kind).toBe("started");
		expect(typeof event.ts).toBe("string");
	});
});

describe("TaskRecord", () => {
	it("accepts a minimal valid record", () => {
		const now = new Date().toISOString();
		const record: TaskRecord = {
			id: "task-1",
			objective: "Do the thing",
			acceptanceCriteria: ["it is done"],
			source: { kind: "manual", createdBy: "test" },
			priority: 2,
			capabilities: [],
			approvalClass: "automatic_read_only",
			status: "queued",
			attempts: 0,
			maxAttempts: 3,
			createdAt: now,
			updatedAt: now,
			history: [],
		};
		expect(record.id).toBe("task-1");
		expect(record.status).toBe("queued");
	});
});

describe("TaskLease", () => {
	it("accepts a valid lease", () => {
		const now = new Date().toISOString();
		const lease: TaskLease = {
			taskId: "task-1",
			workerId: "worker-1",
			acquiredAt: now,
			expiresAt: now,
			heartbeatAt: now,
			attempt: 1,
		};
		expect(lease.workerId).toBe("worker-1");
	});
});

describe("WorkerHeartbeat", () => {
	it("accepts a valid heartbeat", () => {
		const now = new Date().toISOString();
		const heartbeat: WorkerHeartbeat = {
			workerId: "worker-1",
			startedAt: now,
			lastBeatAt: now,
			capacity: 2,
			inflightTaskIds: [],
		};
		expect(heartbeat.workerId).toBe("worker-1");
	});
});
