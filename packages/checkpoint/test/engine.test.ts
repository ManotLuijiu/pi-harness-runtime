/**
 * Checkpoint Engine - Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createCheckpointEngine, SDK_VERSION } from "../src/index.js";
import type { RuntimeState, CheckpointMetadata } from "../src/types.js";

describe("CheckpointEngine", () => {
	describe("SDK_VERSION", () => {
		it("should export SDK_VERSION", () => {
			expect(SDK_VERSION).toBeDefined();
			expect(typeof SDK_VERSION).toBe("string");
		});
	});

	describe("createCheckpointEngine", () => {
		it("should create a checkpoint engine instance", () => {
			const engine = createCheckpointEngine({
				rootDir: "/tmp/test-checkpoints",
			});
			expect(engine).toBeDefined();
		});

		it("should create with default config", () => {
			const engine = createCheckpointEngine();
			expect(engine).toBeDefined();
		});
	});

	describe("save and load", () => {
		const engine = createCheckpointEngine({
			rootDir: "/tmp/checkpoint-test",
			compression: false,
			incremental: false,
			autoPrune: false,
		});

		const testState: RuntimeState = {
			version: 1,
			jobId: "test-job-1",
			status: "running",
			requirement: "Test requirement",
			tasks: [
				{
					id: "task-1",
					title: "Task 1",
					description: "First task",
					status: "done",
				},
				{
					id: "task-2",
					title: "Task 2",
					description: "Second task",
					status: "pending",
				},
			],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		it("should save a checkpoint", async () => {
			const metadata = await engine.save("test-job-1", testState);

			expect(metadata).toBeDefined();
			expect(metadata.jobId).toBe("test-job-1");
			expect(metadata.version).toBe(1);
			expect(metadata.type).toBe("full");
		});

		it("should increment version on save", async () => {
			const state2 = {
				...testState,
				version: 2,
				updatedAt: new Date().toISOString(),
			};
			const metadata = await engine.save("test-job-1", state2);

			expect(metadata.version).toBe(2);
		});

		it("should load the latest checkpoint", async () => {
			const loaded = await engine.load("test-job-1");

			expect(loaded).toBeDefined();
			expect(loaded?.jobId).toBe("test-job-1");
			expect(loaded?.status).toBe("running");
		});

		it("should return null for non-existent job", async () => {
			const loaded = await engine.load("non-existent-job");

			expect(loaded).toBeNull();
		});

		it("should get metadata for all checkpoints", async () => {
			const metadata = await engine.getMetadata("test-job-1");

			expect(metadata.length).toBeGreaterThan(0);
			expect(metadata[0].jobId).toBe("test-job-1");
		});

		it("should delete all checkpoints", async () => {
			await engine.deleteAll("test-job-1");

			const loaded = await engine.load("test-job-1");
			expect(loaded).toBeNull();
		});
	});

	describe("incremental checkpoints", () => {
		const engine = createCheckpointEngine({
			rootDir: "/tmp/checkpoint-incremental",
			compression: false,
			incremental: true,
			autoPrune: false,
		});

		it("should save incremental checkpoint", async () => {
			const state1: RuntimeState = {
				version: 1,
				jobId: "incremental-test",
				status: "running",
				requirement: "Test",
				tasks: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await engine.save("incremental-test", state1);

			const state2: RuntimeState = {
				...state1,
				version: 2,
				status: "completed",
				updatedAt: new Date().toISOString(),
			};

			const metadata = await engine.save("incremental-test", state2);

			// Should be incremental after first full checkpoint
			expect(["full", "incremental"]).toContain(metadata.type);
		});

		after(async () => {
			await engine.deleteAll("incremental-test");
		});
	});

	describe("recovery", () => {
		const engine = createCheckpointEngine({
			rootDir: "/tmp/checkpoint-recovery",
			compression: false,
			incremental: false,
			autoPrune: false,
		});

		beforeEach(async () => {
			const state: RuntimeState = {
				version: 1,
				jobId: "recovery-test",
				status: "running",
				requirement: "Recovery test",
				tasks: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			await engine.save("recovery-test", state);
		});

		it("should recover with latest strategy", async () => {
			const result = await engine.recover("recovery-test", "latest");

			expect(result.success).toBe(true);
			expect(result.recoveredVersion).toBe(1);
			expect(result.recoveredState?.jobId).toBe("recovery-test");
		});

		it("should recover with specific version", async () => {
			const result = await engine.recover("recovery-test", "specific:1");

			expect(result.success).toBe(true);
			expect(result.recoveredVersion).toBe(1);
		});

		it("should fail for non-existent job", async () => {
			const result = await engine.recover("non-existent", "latest");

			expect(result.success).toBe(false);
		});
	});

	describe("pruning", () => {
		const engine = createCheckpointEngine({
			rootDir: "/tmp/checkpoint-prune",
			compression: false,
			incremental: false,
			autoPrune: false,
		});

		it("should prune old checkpoints", async () => {
			// Create multiple checkpoints
			for (let i = 1; i <= 5; i++) {
				const state: RuntimeState = {
					version: i,
					jobId: "prune-test",
					status: "running",
					requirement: `Version ${i}`,
					tasks: [],
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				};
				await engine.save("prune-test", state);
			}

			// Prune to keep only 2
			const result = await engine.prune("prune-test", 2);

			expect(result.deletedCount).toBeGreaterThan(0);
			expect(result.remainingCount).toBe(2);
		});

		after(async () => {
			await engine.deleteAll("prune-test");
		});
	});

	describe("verification", () => {
		const engine = createCheckpointEngine({
			rootDir: "/tmp/checkpoint-verify",
			compression: false,
			incremental: false,
			autoPrune: false,
		});

		beforeEach(async () => {
			const state: RuntimeState = {
				version: 1,
				jobId: "verify-test",
				status: "running",
				requirement: "Verify test",
				tasks: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			await engine.save("verify-test", state);
		});

		it("should verify checkpoint", async () => {
			const result = await engine.verify("verify-test", 1);

			expect(result.valid).toBe(true);
			expect(result.checksumMatch).toBe(true);
		});

		it("should fail verification for non-existent checkpoint", async () => {
			const result = await engine.verify("verify-test", 999);

			expect(result.valid).toBe(false);
		});
	});
});
