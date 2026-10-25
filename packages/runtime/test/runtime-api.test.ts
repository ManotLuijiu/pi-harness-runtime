/**
 * Runtime API tests — the job actions and the states they use.
 *
 * The API stores the job machine the harness registers and moves the job
 * through the state machine. The states are the ones the state machine
 * actually has: `paused_quota` is its only paused state, and there is no
 * plain `paused` status.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
	RuntimeApi,
	type JobStateMachineLike,
	type JobTransitionResult,
} from "../src/runtime-api.js";
import type {
	JobStatus,
	RuntimeCheckpoint,
} from "../../types/dist/runtime-types.js";

/** The states the fake machine accepts. */
const ACCEPTED: JobStatus[] = ["running", "paused_quota", "cancelled"];

/** The envelope every API response uses. */
interface ApiResponseBody<T> {
	success: boolean;
	data?: T;
	error?: string;
}

/** Read the JSON body of a response. */
async function readJson<T>(res: Response): Promise<ApiResponseBody<T>> {
	return (await res.json()) as ApiResponseBody<T>;
}

/** A job machine that records the moves the API asks for. */
class FakeMachine implements JobStateMachineLike {
	status: JobStatus = "running";
	readonly moves: JobStatus[] = [];

	getStatusSummary() {
		return {
			status: this.status,
			isTerminal: this.status === "cancelled",
			canResume: this.status === "paused_quota",
		};
	}

	getCheckpoint(): RuntimeCheckpoint {
		return {
			version: 1,
			jobId: "job-1",
			status: this.status,
			requirement: "do the thing",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
	}

	async resumeJob(): Promise<JobTransitionResult> {
		return { success: true };
	}

	async transition(to: JobStatus): Promise<JobTransitionResult> {
		this.moves.push(to);
		if (!ACCEPTED.includes(to)) {
			return { success: false, error: `Invalid transition to ${to}` };
		}
		this.status = to;
		return { success: true };
	}
}

describe("RuntimeApi job actions", () => {
	let api: RuntimeApi;
	let machine: FakeMachine;
	let base: string;

	beforeEach(async () => {
		api = new RuntimeApi({ port: 0, host: "127.0.0.1" });
		machine = new FakeMachine();
		api.registerJob("job-1", machine);
		await api.start();
		base = `http://127.0.0.1:${api.getPort()}`;
	});

	afterEach(async () => {
		await api.stop();
	});

	it("pauses a job into the state the machine has", async () => {
		const res = await fetch(`${base}/jobs/job-1?action=pause`, {
			method: "POST",
		});

		expect(res.status).toBe(200);
		expect(machine.moves).toEqual(["paused_quota"]);
		expect(machine.status).toBe("paused_quota");
	});

	it("resumes a paused job", async () => {
		await fetch(`${base}/jobs/job-1?action=pause`, { method: "POST" });
		machine.moves.length = 0;

		const res = await fetch(`${base}/jobs/job-1?action=resume`, {
			method: "POST",
		});

		expect(res.status).toBe(200);
		expect(machine.moves).toEqual(["running"]);
		expect(machine.status).toBe("running");
	});

	it("cancels a job", async () => {
		const res = await fetch(`${base}/jobs/job-1?action=cancel`, {
			method: "POST",
		});

		expect(res.status).toBe(200);
		expect(machine.status).toBe("cancelled");
	});

	it("reports a refused move instead of a false success", async () => {
		const refusing = new FakeMachine();
		refusing.transition = async (to: JobStatus) => {
			refusing.moves.push(to);
			return { success: false, error: "the state machine refused the move" };
		};
		api.registerJob("job-2", refusing);

		const res = await fetch(`${base}/jobs/job-2?action=pause`, {
			method: "POST",
		});

		expect(res.status).toBe(409);
		const body = await readJson<never>(res);
		expect(body.error).toBe("the state machine refused the move");
	});

	it("rejects an unknown action", async () => {
		const res = await fetch(`${base}/jobs/job-1?action=explode`, {
			method: "POST",
		});

		expect(res.status).toBe(400);
		expect(machine.moves).toEqual([]);
	});

	it("counts a paused job as paused", async () => {
		await fetch(`${base}/jobs/job-1?action=pause`, { method: "POST" });

		const res = await fetch(`${base}/status`);
		const body = await readJson<{
			jobs: { total: number; active: number; paused: number; completed: number };
		}>(res);

		expect(body.data?.jobs.total).toBe(1);
		expect(body.data?.jobs.paused).toBe(1);
		expect(body.data?.jobs.active).toBe(0);
	});

	it("reports an unknown job", async () => {
		const res = await fetch(`${base}/jobs/nope?action=pause`, {
			method: "POST",
		});

		expect(res.status).toBe(404);
	});
});
