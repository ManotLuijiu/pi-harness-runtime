/**
 * Tests for LoopRuntime auto-continuation on output limits and compaction markers.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { LoopRuntime } = await import("../harness/loop-runtime.ts");

function createTask() {
	return {
		id: "task-1",
		title: "Implement feature",
		description: "Finish the interrupted task",
		status: "ready",
		instructions: "Continue working until complete.",
	};
}

describe("LoopRuntime auto continuation", () => {
	it("continues automatically when finishReason is length", async () => {
		const task = createTask();
		const invocations = [];
		let pickCount = 0;
		let reviewCount = 0;

		const runtime = new LoopRuntime(
			{
				jobId: "job-output-limit",
				requirement: "Test output limit auto continuation",
				maxIterations: 3,
				checkpointInterval: 10,
				autoCheckpoint: false,
				pauseOnQuota: true,
				maxRepairAttempts: 3,
			},
			{
				onPickTask: async () => {
					pickCount += 1;
					return pickCount === 1 ? task : null;
				},
				onPickModel: async () => "claude-test",
				onInvokeAgent: async (opts) => {
					invocations.push(
						opts.messages.map((m) => ({ role: m.role, content: m.content })),
					);
					if (invocations.length === 1) {
						return {
							success: true,
							output: "Partial answer before truncation",
							finishReason: "length",
							model: "claude-test",
						};
					}
					return {
						success: true,
						output: "Final completed answer",
						finishReason: "stop",
						model: "claude-test",
					};
				},
				onRunTests: async () => true,
				onRunE2E: async () => true,
				onReview: async () => {
					reviewCount += 1;
					return "approve";
				},
			},
		);

		const result = await runtime.run();
		assert.equal(result.completed, true);
		assert.equal(invocations.length, 2);
		assert.equal(reviewCount, 1);
		assert.ok(
			invocations[1].some(
				(message) =>
					message.role === "user" &&
					message.content.includes("Output token limit hit. Resume directly"),
			),
		);
	});

	it("continues automatically when output contains compaction markers", async () => {
		const task = createTask();
		const invocations = [];
		let pickCount = 0;

		const runtime = new LoopRuntime(
			{
				jobId: "job-compaction-marker",
				requirement: "Test compaction-marker auto continuation",
				maxIterations: 3,
				checkpointInterval: 10,
				autoCheckpoint: false,
				pauseOnQuota: true,
				maxRepairAttempts: 3,
			},
			{
				onPickTask: async () => {
					pickCount += 1;
					return pickCount === 1 ? task : null;
				},
				onPickModel: async () => "claude-test",
				onInvokeAgent: async (opts) => {
					invocations.push(
						opts.messages.map((m) => ({ role: m.role, content: m.content })),
					);
					if (invocations.length === 1) {
						return {
							success: true,
							output:
								"Error: Model stopped because it reached the maximum output token limit.\n\n[compaction]\n\nCompacted from 200,893 tokens",
							finishReason: "stop",
							model: "claude-test",
						};
					}
					return {
						success: true,
						output: "Continued after compaction",
						finishReason: "stop",
						model: "claude-test",
					};
				},
				onRunTests: async () => true,
				onRunE2E: async () => true,
				onReview: async () => "approve",
			},
		);

		const result = await runtime.run();
		assert.equal(result.completed, true);
		assert.equal(invocations.length, 2);
		assert.ok(
			invocations[1].some(
				(message) =>
					message.role === "user" &&
					message.content.toLowerCase().includes("continue"),
			),
		);
	});
});
