import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, defineTask } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ReviewJobDoc, WorkerOwnerDoc } from "../packages/durable-review/src/documents.ts";

const sqliteAvailable = await import("node:sqlite").then(() => true, () => false);

test("review documents preserve their delta checkpoint policy", () => {
	for (const token of [ReviewJobDoc, WorkerOwnerDoc]) {
		assert.equal(token.definition.checkpointWhen(token.definition.initial(), [], { deltasSinceBase: 0 }), false);
	}
});

test("Pi 1.6 persists and reopens review jobs and worker ownership after multiple edits", {
	skip: sqliteAvailable ? false : "node:sqlite is unavailable in this runtime",
}, async () => {
	const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
	const directory = await mkdtemp(join(tmpdir(), "durable-review-documents-"));
	const path = join(directory, "review.sqlite");
	let session;
	try {
		const task = defineTask({
			name: "test.review-documents", version: 1,
			initial: () => ({ phase: "idle" }),
			phases: { idle: () => { throw new Error("this persistence test must not schedule a task"); } },
		});
		session = createSession(await openNodeSqliteStorage(path));
		let taskId;
		await session.commit(async (tx) => {
			const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
			taskId = await tx.createTask(task, {}, { ownership: { kind: "conversation" }, conversationId: conversation.id });
			const jobs = await tx.doc(ReviewJobDoc, taskId);
			jobs.jobs.example = { status: "queued", findings: [] };
			const owner = await tx.doc(WorkerOwnerDoc, taskId);
			owner.ownerId = "synthetic-worker";
			owner.pid = 123;
			owner.startedAt = "2026-01-01T00:00:00Z";
		}, BACKGROUND_CONTEXT);
		for (const status of ["running", "completed"]) {
			await session.commit(async (tx) => {
				const jobs = await tx.doc(ReviewJobDoc, taskId);
				jobs.jobs.example.status = status;
				const owner = await tx.doc(WorkerOwnerDoc, taskId);
				owner.lastHeartbeat = status;
			}, BACKGROUND_CONTEXT);
		}
		await session.close(BACKGROUND_CONTEXT);
		session = createSession(await openNodeSqliteStorage(path));
		const jobs = await session.snapshot(ReviewJobDoc, taskId, BACKGROUND_CONTEXT);
		assert.equal(jobs.schemaVersion, 1);
		assert.deepEqual(jobs.jobs.example, { status: "completed", findings: [] });
		const owner = await session.snapshot(WorkerOwnerDoc, taskId, BACKGROUND_CONTEXT);
		assert.equal(owner.ownerId, "synthetic-worker");
		assert.equal(owner.pid, 123);
		assert.equal(owner.lastHeartbeat, "completed");
	} finally {
		await session?.close(BACKGROUND_CONTEXT);
		await rm(directory, { recursive: true, force: true });
	}
});
