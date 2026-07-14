/**
 * Scheduler Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { JsonRuntimeScheduler } from "../src/scheduler";

const TMP = join(process.cwd(), ".test-scheduler-tmp");

function scheduler(): JsonRuntimeScheduler {
	return new JsonRuntimeScheduler(TMP);
}

beforeEach(() => {
	rmSync(TMP, { force: true, recursive: true });
	mkdirSync(TMP, { recursive: true });
});

describe("JsonRuntimeScheduler", () => {
	describe("scheduleResume", () => {
		it("writes a job to schedule.json", async () => {
			const s = scheduler();
			await s.scheduleResume("job-1", "2025-01-01T12:00:00Z", "test reason");
			const jobs = await s.readAll();
			expect(jobs).toHaveLength(1);
			expect(jobs[0].jobId).toBe("job-1");
			expect(jobs[0].status).toBe("scheduled");
			expect(jobs[0].reason).toBe("test reason");
		});

		it("overwrites existing job with same ID", async () => {
			const s = scheduler();
			await s.scheduleResume("job-1", "2025-01-01T12:00:00Z", "reason A");
			await s.scheduleResume("job-1", "2025-01-02T12:00:00Z", "reason B");
			const jobs = await s.readAll();
			expect(jobs).toHaveLength(1);
			expect(jobs[0].reason).toBe("reason B");
		});

		it("keeps separate jobs distinct", async () => {
			const s = scheduler();
			await s.scheduleResume("job-A", "2025-01-01T12:00:00Z", "reason A");
			await s.scheduleResume("job-B", "2025-01-02T12:00:00Z", "reason B");
			const jobs = await s.readAll();
			expect(jobs).toHaveLength(2);
		});
	});

	describe("dueJobs", () => {
		it("returns empty when nothing is due", async () => {
			const s = scheduler();
			await s.scheduleResume("job-1", "2099-12-31T23:59:59Z", "far future");
			const due = await s.dueJobs(new Date("2025-01-01"));
			expect(due).toHaveLength(0);
		});

		it("returns job when resumeAt has passed", async () => {
			const s = scheduler();
			await s.scheduleResume("job-1", "2024-01-01T12:00:00Z", "past");
			const due = await s.dueJobs(new Date("2025-01-01"));
			expect(due).toEqual(["job-1"]);
		});

		it("skips cancelled jobs", async () => {
			const s = scheduler();
			await s.scheduleResume("job-1", "2024-01-01T12:00:00Z", "cancelled");
			await s.cancel("job-1");
			const due = await s.dueJobs(new Date("2025-01-01"));
			expect(due).toHaveLength(0);
		});

		it("returns multiple due jobs", async () => {
			const s = scheduler();
			await s.scheduleResume("job-A", "2024-01-01T12:00:00Z", "A");
			await s.scheduleResume("job-B", "2024-01-02T12:00:00Z", "B");
			await s.cancel("job-A");
			const due = await s.dueJobs(new Date("2025-01-01"));
			expect(due).toEqual(["job-B"]);
		});

		it("ignores resumeAt in the future", async () => {
			const s = scheduler();
			await s.scheduleResume("job-future", "2099-01-01T00:00:00Z", "too late");
			const due = await s.dueJobs(new Date("2025-06-15"));
			expect(due).toHaveLength(0);
		});
	});

	describe("cancel", () => {
		it("sets status to cancelled", async () => {
			const s = scheduler();
			await s.scheduleResume("job-1", "2024-01-01T00:00:00Z", "to cancel");
			await s.cancel("job-1");
			const jobs = await s.readAll();
			expect(jobs).toHaveLength(1);
			expect(jobs[0].status).toBe("cancelled");
		});

		it("no-op for unknown job", async () => {
			const s = scheduler();
			await s.scheduleResume("job-1", "2024-01-01T00:00:00Z", "exists");
			await s.cancel("nonexistent");
			const jobs = await s.readAll();
			expect(jobs).toHaveLength(1);
		});

		it("cancelled job not returned by dueJobs", async () => {
			const s = scheduler();
			await s.scheduleResume("job-1", "2020-01-01T00:00:00Z", "was due");
			await s.cancel("job-1");
			const due = await s.dueJobs(new Date("2025-01-01"));
			expect(due).toHaveLength(0);
		});
	});

	describe("readAll", () => {
		it("returns empty array for missing file", async () => {
			const s = scheduler();
			const jobs = await s.readAll();
			expect(jobs).toEqual([]);
		});
	});
});
