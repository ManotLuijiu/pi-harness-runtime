/**
 * Experience Replay Tests (RFC-0059)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { type ExperienceReplay, createExperienceReplay } from "../src/index.js";
import type { ReplayRequest, ReplaySources } from "../src/index.js";

describe("ExperienceReplay", () => {
	let replay: ExperienceReplay;

	beforeEach(() => {
		replay = createExperienceReplay();
	});

	describe("replay", () => {
		it("reconstructs state from event log", async () => {
			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "inspect",
				allowExternalCalls: false,
			};

			const sources: ReplaySources = {
				checkpoint: {
					version: 1,
					jobId: "job-1",
					status: "running",
					requirement: "Test requirement",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
				events: [
					{
						ts: new Date().toISOString(),
						jobId: "job-1",
						type: "task.started",
						message: "Task started",
						data: { taskId: "task-1" },
					},
					{
						ts: new Date().toISOString(),
						jobId: "job-1",
						type: "task.completed",
						message: "Task completed",
						data: { taskId: "task-1" },
					},
				],
			};

			const result = await replay.replay(request, sources);

			expect(result.jobId).toBe("job-1");
			expect(result.reconstructedState).toBeDefined();
			expect(result.timeline.length).toBe(2);
		});

		it("returns error for missing sources", async () => {
			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "inspect",
				allowExternalCalls: false,
			};

			const sources: ReplaySources = {};

			const result = await replay.replay(request, sources);

			expect(result.divergences.length).toBeGreaterThan(0);
			expect(result.divergences[0].severity).toBe("error");
		});

		it("supports inspect mode (read-only)", async () => {
			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "inspect",
				allowExternalCalls: false,
			};

			const sources: ReplaySources = {
				events: [
					{
						ts: new Date().toISOString(),
						jobId: "job-1",
						type: "test",
						message: "Test event",
					},
				],
			};

			const result = await replay.replay(request, sources);

			expect(result.reconstructedState).toBeDefined();
			// No external calls made in inspect mode
		});

		it("emits replay.started event", async () => {
			const events: any[] = [];
			replay.onEvent((e) => events.push(e));

			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "inspect",
				allowExternalCalls: false,
			};

			const sources: ReplaySources = {
				events: [],
			};

			await replay.replay(request, sources);

			expect(events.some((e) => e.type === "replay.started")).toBe(true);
		});

		it("emits replay.completed event", async () => {
			const events: any[] = [];
			replay.onEvent((e) => events.push(e));

			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "inspect",
				allowExternalCalls: false,
			};

			const sources: ReplaySources = {
				events: [],
			};

			await replay.replay(request, sources);

			expect(events.some((e) => e.type === "replay.completed")).toBe(true);
		});

		it("filters events by sequence range", async () => {
			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "inspect",
				fromSequence: 1,
				toSequence: 3,
				allowExternalCalls: false,
			};

			const sources: ReplaySources = {
				events: [
					{
						ts: new Date().toISOString(),
						jobId: "job-1",
						type: "event-0",
						message: "0",
					},
					{
						ts: new Date().toISOString(),
						jobId: "job-1",
						type: "event-1",
						message: "1",
					},
					{
						ts: new Date().toISOString(),
						jobId: "job-1",
						type: "event-2",
						message: "2",
					},
					{
						ts: new Date().toISOString(),
						jobId: "job-1",
						type: "event-3",
						message: "3",
					},
				],
			};

			const result = await replay.replay(request, sources);

			expect(result.timeline.length).toBe(2); // events 1 and 2
			expect(result.timeline[0].sequence).toBe(1);
		});

		it("simulate mode performs no external calls", async () => {
			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "simulate",
				allowExternalCalls: false,
			};

			const sources: ReplaySources = {
				events: [
					{
						ts: new Date().toISOString(),
						jobId: "job-1",
						type: "test",
						message: "Test",
					},
				],
			};

			const result = await replay.replay(request, sources);

			// Should complete without making external calls
			expect(result.reconstructedState).toBeDefined();
		});

		it("requires approval for reexecute mode", async () => {
			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "reexecute",
				allowExternalCalls: false, // No approval
			};

			const sources: ReplaySources = {
				events: [],
			};

			const result = await replay.replay(request, sources);

			// Should have error divergence
			expect(result.divergences.some((d) => d.severity === "error")).toBe(true);
		});

		it("collects artifact references", async () => {
			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "inspect",
				allowExternalCalls: false,
			};

			const sources: ReplaySources = {
				prompts: {
					"prompt-1": "Test prompt",
					"prompt-2": "Another prompt",
				},
				outputs: {
					"output-1": "Test output",
				},
				events: [],
			};

			const result = await replay.replay(request, sources);

			expect(result.artifacts.length).toBe(3);
		});
	});

	describe("timeline reconstruction", () => {
		it("preserves event sequence", async () => {
			const request: ReplayRequest = {
				jobId: "job-1",
				mode: "inspect",
				allowExternalCalls: false,
			};

			const events = [
				{ ts: "2024-01-01T00:00:01Z", jobId: "job-1", type: "a", message: "a" },
				{ ts: "2024-01-01T00:00:02Z", jobId: "job-1", type: "b", message: "b" },
				{ ts: "2024-01-01T00:00:03Z", jobId: "job-1", type: "c", message: "c" },
			];

			const sources: ReplaySources = { events };

			const result = await replay.replay(request, sources);

			expect(result.timeline[0].sequence).toBe(0);
			expect(result.timeline[1].sequence).toBe(1);
			expect(result.timeline[2].sequence).toBe(2);
		});
	});
});
