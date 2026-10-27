/**
 * The persisted state.
 *
 * The phase, the start revision, the scope, the finished chunks and the open
 * findings survive a restart, so the workflow can be resumed after a
 * compaction or a reset.
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import {
	TwoPhaseStateStore,
	allChunksDone,
	completeWithoutReview,
	createState,
	hasQueuedReview,
	markChunkDone,
	markComplete,
	moveToPhase,
	normalizeState,
	recordFinding,
	recordSignal,
	safeFileName,
	startReview,
	transitionToReviewFixes,
	transitionToReviewPending,
} from "../src/state.js";
import type { ReviewChunk, ReviewSignal } from "../src/types.js";
import { withTempDir } from "./helpers.js";

/** A review chunk of the given id. */
function chunk(id: string): ReviewChunk {
	return { id, label: `${id} (1 file)`, files: [`${id}.ts`], status: "pending" };
}

const signal: ReviewSignal = {
	source: "code-reviewer",
	files: ["index.ts"],
	reason: "a comprehensive review was requested with code-reviewer",
	at: "2026-10-25T00:00:00.000Z",
};

describe("createState", () => {
	it("starts in the implementation phase", () => {
		const state = createState("task-1", "abc123");
		expect(state.phase).toBe("implementation");
		expect(state.startRevision).toBe("abc123");
		expect(state.signals).toEqual([]);
	});
});

describe("signals", () => {
	it("records a signal once", () => {
		const once = recordSignal(createState("t"), signal);
		const twice = recordSignal(once, signal);
		expect(twice.signals).toHaveLength(1);
		expect(hasQueuedReview(twice)).toBe(true);
	});

	it("keeps the phase while a signal is recorded", () => {
		const state = recordSignal(createState("t"), signal);
		expect(state.phase).toBe("implementation");
	});
});

describe("phases", () => {
	it("moves forward only", () => {
		const state = createState("t");
		expect(moveToPhase(state, "review_pending").phase).toBe("review_pending");
		expect(moveToPhase(state, "implementation").phase).toBe("implementation");
		const review = moveToPhase(state, "review");
		expect(moveToPhase(review, "implementation").phase).toBe("review");
	});

	it("does not move back from the review into the implementation", () => {
		const review = startReview(createState("t"), []);
		expect(moveToPhase(review, "implementation").phase).toBe("review");
	});

	it("enters the review with the scope and the chunks", () => {
		const pending = transitionToReviewPending(createState("t"), ["a.ts", "b.ts"]);
		expect(pending.phase).toBe("review_pending");
		expect(pending.scopeFiles).toEqual(["a.ts", "b.ts"]);

		const review = startReview(pending, [
			{ id: "chunk-1", label: "packages/x (1 file)", files: ["a.ts"], status: "pending" },
		]);
		expect(review.phase).toBe("review");
		expect(review.chunks).toHaveLength(1);
	});

	it("marks the chunks as done", () => {
		const review = startReview(createState("t"), [
			{ id: "chunk-1", label: "a", files: ["a.ts"], status: "pending" },
			{ id: "chunk-2", label: "b", files: ["b.ts"], status: "pending" },
		]);
		const one = markChunkDone(review, "chunk-1");
		expect(allChunksDone(one)).toBe(false);
		const both = markChunkDone(one, "chunk-2");
		expect(allChunksDone(both)).toBe(true);
	});

	it("enters the fixes only when the review is finished", () => {
		const review = startReview(createState("t"), [chunk("chunk-1")]);
		expect(transitionToReviewFixes(review).phase).toBe("review");

		const withFinding = recordFinding(review, {
			id: "finding-1",
			severity: "medium",
			summary: "the callback is not idempotent",
			at: "2026-10-25T00:00:00.000Z",
		});
		// The review has not run over every chunk yet.
		expect(transitionToReviewFixes(withFinding).phase).toBe("review");

		const reviewed = markChunkDone(withFinding, "chunk-1");
		expect(transitionToReviewFixes(reviewed).phase).toBe("review_fixes");
		expect(withFinding.findings).toHaveLength(1);
	});

	it("marks the task complete only when the review ran", () => {
		// The implementation alone never completes the task.
		expect(markComplete(createState("t")).phase).toBe("implementation");

		const review = startReview(createState("t"), [chunk("chunk-1")]);
		expect(markComplete(review).phase).toBe("review");

		const reviewed = markChunkDone(review, "chunk-1");
		expect(markComplete(reviewed).phase).toBe("complete");
	});

	it("completes a task without a review only when the scope is empty", () => {
		// A task that changed a file needs the review.
		expect(completeWithoutReview(createState("t"), ["index.ts"]).phase).toBe(
			"implementation",
		);
		// A task without a diff has nothing a review could cover.
		expect(completeWithoutReview(createState("t"), []).phase).toBe("complete");
		// The completion never moves the phase backwards.
		const review = startReview(createState("t"), [chunk("chunk-1")]);
		expect(completeWithoutReview(review, []).phase).toBe("review");
	});

	it("never moves the phase backwards", () => {
		const review = startReview(createState("t"), [chunk("chunk-1")]);
		const done = markComplete(markChunkDone(review, "chunk-1"));
		expect(done.phase).toBe("complete");
		// A late transition cannot undo the completion.
		expect(transitionToReviewFixes(done).phase).toBe("complete");
		expect(moveToPhase(done, "review").phase).toBe("complete");
	});
});

describe("TwoPhaseStateStore", () => {
	it("writes and reads the state of a task", () => {
		withTempDir("state", (dir) => {
			const store = new TwoPhaseStateStore(dir);
			const state = recordSignal(createState("task-1", "rev1"), signal);
			store.write(state);

			const read = store.read("task-1");
			expect(read?.phase).toBe("implementation");
			expect(read?.signals).toHaveLength(1);
			expect(read?.startRevision).toBe("rev1");
		});
	});

	it("returns nothing for an unknown task", () => {
		withTempDir("state", (dir) => {
			const store = new TwoPhaseStateStore(dir);
			expect(store.read("unknown")).toBeNull();
		});
	});

	it("reports a corrupt state instead of losing it", () => {
		withTempDir("state", (dir) => {
			const store = new TwoPhaseStateStore(dir);
			store.write(createState("task-1", "rev1"));
			writeFileSync(store.path("task-1"), "{not json", "utf8");

			// A corrupt state must not look like a fresh task: that would lose
			// the revision the task started at and the progress of the review.
			expect(() => store.read("task-1")).toThrow(/not valid JSON/);
		});
	});

	it("leaves no temporary file behind", () => {
		withTempDir("state", (dir) => {
			const store = new TwoPhaseStateStore(dir);
			store.write(createState("task-1"));
			store.write(createState("task-1"));
			expect(readdirSync(dir).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
		});
	});

	it("keeps the tasks apart", () => {
		withTempDir("state", (dir) => {
			const store = new TwoPhaseStateStore(dir);
			store.write(recordSignal(createState("task-a"), signal));
			store.write(createState("task-b"));
			expect(store.read("task-a")?.signals).toHaveLength(1);
			expect(store.read("task-b")?.signals).toHaveLength(0);
		});
	});

	it("repairs a broken state", () => {
		expect(normalizeState({ phase: "nonsense" }, "task-1").phase).toBe("implementation");
		expect(normalizeState(null, "task-1").taskId).toBe("task-1");
	});

	it("uses a safe file name", () => {
		expect(safeFileName("session/with spaces")).toBe("session_with_spaces");
	});
});
