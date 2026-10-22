/**
 * Tests for Job State Machine — RFC-0015
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const checkpoints = new Map();
const events = [];

const mockManager = {
	async save(cp) {
		checkpoints.set(cp.jobId, cp);
	},
	async load(jobId) {
		return checkpoints.get(jobId) ?? null;
	},
	async appendEvent(_jobId, event) {
		events.push(event);
	},
};

// Import after setting up mocks
const { JobStateMachine, FileCheckpointManager, checkpointDirName } = await import(
	"../harness/job-state-machine.ts",
);

describe("JobStateMachine", () => {
	let machine;

	beforeEach(() => {
		checkpoints.clear();
		events.length = 0;
		machine = new JobStateMachine({ checkpointManager: mockManager });
	});

	it("creates a new job with created status", async () => {
		const result = await machine.createJob("job-001", "Build a feature");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "created");
		assert.strictEqual(result.checkpoint?.jobId, "job-001");
		assert.strictEqual(result.checkpoint?.requirement, "Build a feature");
	});

	it("transitions from created to planning", async () => {
		await machine.createJob("job-001", "Build a feature");
		const result = await machine.transition("planning");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "planning");
	});

	it("rejects invalid transitions", async () => {
		await machine.createJob("job-001", "Build a feature");
		const result = await machine.transition("ready_for_client");
		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes("Invalid transition"));
	});

	it("transitions from planning to queued to running", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		const result = await machine.transition("running");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "running");
	});

	it("transitions from running to testing", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		const result = await machine.transition("testing");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "testing");
	});

	it("transitions from testing to reviewing", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.transition("testing");
		const result = await machine.transition("reviewing");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "reviewing");
	});

	it("transitions from reviewing to ready_for_client", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.transition("testing");
		await machine.transition("reviewing");
		const result = await machine.transition("ready_for_client");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "ready_for_client");
	});

	it("transitions to paused_quota when quota is exhausted", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		const result = await machine.transition("paused_quota");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "paused_quota");
	});

	it("resumes from paused_quota", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.transition("paused_quota");
		const result = await machine.transition("running");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "running");
	});

	it("transitions to repairing on failure", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.transition("testing");
		const result = await machine.transition("repairing");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "repairing");
	});

	it("cancels from planning", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		const result = await machine.transition("cancelled");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "cancelled");
	});

	it("archives from ready_for_client", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.transition("testing");
		await machine.transition("reviewing");
		await machine.transition("ready_for_client");
		const result = await machine.transition("archived");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.checkpoint?.status, "archived");
	});

	it("canResume returns true for paused_quota", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.transition("paused_quota");
		assert.strictEqual(machine.canResume(), true);
	});

	it("isTerminal returns true for ready_for_client", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.transition("testing");
		await machine.transition("reviewing");
		await machine.transition("ready_for_client");
		assert.strictEqual(machine.isTerminal(), true);
	});

	it("isTerminal returns true for cancelled", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("cancelled");
		assert.strictEqual(machine.isTerminal(), true);
	});

	it("records last error", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.recordError("Build failed");
		assert.strictEqual(machine.getCheckpoint()?.lastError, "Build failed");
	});

	it("sets resume time", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		await machine.transition("queued");
		await machine.transition("running");
		await machine.transition("paused_quota");
		const resumeAt = new Date(Date.now() + 3600000).toISOString();
		await machine.setResumeTime(resumeAt);
		assert.strictEqual(machine.getCheckpoint()?.resumeAt, resumeAt);
	});

	it("emits events on transition", async () => {
		await machine.createJob("job-001", "Build a feature");
		await machine.transition("planning");
		assert.strictEqual(events.length, 2); // JobCreated + 1 transition
	});

	it("returns available transitions", async () => {
		await machine.createJob("job-001", "Build a feature");
		const transitions = machine.getAvailableTransitions();
		assert.ok(transitions.includes("planning"));
		assert.ok(!transitions.includes("running")); // Not available from created
	});

	it("fails without active job", async () => {
		const result = await machine.transition("planning");
		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes("No active job"));
	});

	it("stores and retrieves checkpoint", async () => {
		await machine.createJob("job-001", "Build a feature");
		const checkpoint = machine.getCheckpoint();
		assert.ok(checkpoint);
		assert.strictEqual(checkpoint?.jobId, "job-001");
	});
});

describe("FileCheckpointManager", () => {
	let rootDir;
	let manager;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "job-state-machine-"));
		manager = new FileCheckpointManager(rootDir);
	});

	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	it("saves and loads a checkpoint", async () => {
		await manager.save({ jobId: "job-001", status: "created" });
		const loaded = await manager.load("job-001");
		assert.strictEqual(loaded?.jobId, "job-001");
		assert.strictEqual(loaded?.status, "created");
	});

	it("returns null for an unknown job", async () => {
		assert.strictEqual(await manager.load("does-not-exist"), null);
	});

	it("returns null for a corrupted checkpoint file", async () => {
		const dir = join(rootDir, "checkpoints", checkpointDirName("job-001"));
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "checkpoint.json"), "{not json", "utf8");
		assert.strictEqual(await manager.load("job-001"), null);
	});

	it("appends events instead of overwriting them", async () => {
		await manager.appendEvent("job-001", { type: "started" });
		await manager.appendEvent("job-001", { type: "finished" });
		const raw = await readFile(
			join(rootDir, "checkpoints", checkpointDirName("job-001"), "events.jsonl"),
			"utf8",
		);
		const lines = raw.trim().split("\n");
		assert.strictEqual(lines.length, 2);
		assert.strictEqual(JSON.parse(lines[0]).type, "started");
	});

	it("keeps a traversal job id inside the checkpoints directory", async () => {
		await manager.save({ jobId: "..", status: "created" });
		// ".." must not resolve to the root directory itself.
		assert.strictEqual(
			existsSync(join(rootDir, "checkpoint.json")),
			false,
			"the checkpoint escaped the checkpoints directory",
		);
		const entries = await readdir(join(rootDir, "checkpoints"));
		assert.strictEqual(entries.length, 1);
		assert.ok(!entries.includes(".."));
	});

	it("keeps the dot and empty job ids inside the checkpoints directory", async () => {
		await manager.save({ jobId: ".", status: "created" });
		await manager.save({ jobId: "", status: "created" });
		assert.strictEqual(
			existsSync(join(rootDir, "checkpoint.json")),
			false,
			"the checkpoint escaped the checkpoints directory",
		);
		const entries = await readdir(join(rootDir, "checkpoints"));
		assert.strictEqual(entries.length, 2);
		for (const entry of entries) {
			assert.ok(!entry.includes("/"));
			assert.notStrictEqual(entry, ".");
			assert.notStrictEqual(entry, "..");
		}
	});

	it("gives two similar job ids separate directories", async () => {
		await manager.save({ jobId: "a/b", status: "created" });
		await manager.save({ jobId: "a_b", status: "created" });
		const entries = await readdir(join(rootDir, "checkpoints"));
		assert.strictEqual(entries.length, 2);
		// Both checkpoints must still be loadable and keep their own id.
		assert.strictEqual((await manager.load("a/b"))?.jobId, "a/b");
		assert.strictEqual((await manager.load("a_b"))?.jobId, "a_b");
	});
});
