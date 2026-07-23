/**
 * Tests for autonomous-runtime types.
 */

import { describe, it, expect } from "bun:test";
import type {
	TaskSpec,
	TaskStatus,
	TaskEvent,
	TaskRecord,
	LeaseStatus,
	WorkerStatus,
} from "../src/types.js";

describe("TaskStatus enum", () => {
	it("has all expected values", () => {
		const values: TaskStatus[] = [
			"pending",
			"claimed",
			"running",
			"completed",
			"failed",
			"cancelled",
		];
		for (const v of values) {
			expect(typeof v).toBe("string");
		}
	});
});

describe("LeaseStatus enum", () => {
	it("has all expected values", () => {
		const values: LeaseStatus[] = [
			"active",
			"renewed",
			"released",
			"expired",
		];
		for (const v of values) {
			expect(typeof v).toBe("string");
		}
	});
});

describe("TaskSpec", () => {
	it("accepts a minimal valid spec", () => {
		const spec: TaskSpec = {
			id: "task-1",
			kind: "once",
			priority: 5,
			spec: {},
		};
		expect(spec.id).toBe("task-1");
		expect(spec.kind).toBe("once");
		expect(spec.priority).toBe(5);
	});
});

describe("WorkerStatus", () => {
	it("accepts a valid status", () => {
		const status: WorkerStatus = {
			workerId: "worker-1",
			running: true,
			heartbeatIntervalMs: 30_000,
		};
		expect(status.running).toBe(true);
	});
});
