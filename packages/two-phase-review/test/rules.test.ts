/**
 * The workflow rules.
 *
 * The injected instruction names the phase, the open work and the next step.
 * It must never suggest to start the review while the implementation runs.
 */

import { describe, it, expect } from "bun:test";
import {
	TWO_PHASE_CONTRACT,
	buildChunkTodoSubject,
	buildPhaseInstruction,
	buildPhaseView,
	buildReviewTodoDescription,
	buildReviewTodoSubject,
	formatPhaseStatus,
	isChunkTodo,
	syncChunkStatus,
} from "../src/rules.js";
import {
	createState,
	recordSignal,
	startReview,
	transitionToReviewPending,
	transitionToTestPending,
} from "../src/state.js";
import { REVIEW_PREFIX } from "../src/classify.js";
import type { ReviewChunk, ReviewSignal } from "../src/types.js";

const signal: ReviewSignal = {
	source: "code-reviewer",
	files: ["packages/notification/index.ts"],
	reason: "a comprehensive review was requested with code-reviewer",
	at: "2026-10-25T00:00:00.000Z",
};

describe("TWO_PHASE_CONTRACT", () => {
	it("names the two phases", () => {
		expect(TWO_PHASE_CONTRACT).toContain("Phase 1");
		expect(TWO_PHASE_CONTRACT).toContain("Phase 2");
	});

	it("keeps the correctness checks in the implementation", () => {
		expect(TWO_PHASE_CONTRACT).toContain("type errors");
	});

	it("names the todo prefixes", () => {
		expect(TWO_PHASE_CONTRACT).toContain("[IMPLEMENT]");
		expect(TWO_PHASE_CONTRACT).toContain(REVIEW_PREFIX);
		expect(TWO_PHASE_CONTRACT).toContain("[REVIEW-FIX]");
	});
});

describe("buildPhaseInstruction", () => {
	it("asks for the implementation while it runs", () => {
		const state = createState("t");
		const view = buildPhaseView(state, [
			{ id: 1, subject: "Add the storage", status: "pending" },
		]);
		const instruction = buildPhaseInstruction(state, view);
		expect(instruction).toContain("Phase 1");
		expect(instruction).toContain("1 implementation todo(s) open");
		expect(instruction).toContain("Do not start a comprehensive review");
	});

	it("does not start the review while a signal is queued", () => {
		const state = recordSignal(createState("t"), signal);
		const view = buildPhaseView(state, [
			{ id: 1, subject: "Add the storage", status: "pending" },
		]);
		const instruction = buildPhaseInstruction(state, view);
		expect(instruction).toContain("must not start yet");
		expect(instruction).toContain("code-reviewer");
	});

	it("asks for the review when the implementation is done", () => {
		const pending = transitionToReviewPending(createState("t"), ["a.ts", "b.ts"]);
		const state = startReview(pending, [
			{ id: "chunk-1", label: "packages/x (2 files)", files: ["a.ts", "b.ts"], status: "pending" },
		]);
		const view = buildPhaseView(state, []);
		const instruction = buildPhaseInstruction(state, view);
		expect(instruction).toContain("Phase 2");
		expect(instruction).toContain("chunk-1");
		expect(instruction).toContain("never the whole repository");
	});

	it("asks for the fixes when the review found something", () => {
		const state = { ...createState("t"), phase: "review_fixes" as const };
		const view = buildPhaseView(state, [
			{ id: 1, subject: "[REVIEW-FIX] Fix the race", status: "pending" },
		]);
		const instruction = buildPhaseInstruction(state, view);
		expect(instruction).toContain("review-fix todo(s) open");
	});
});

describe("the queued review todo", () => {
	it("is one item with the source and the scope", () => {
		const state = transitionToReviewPending(recordSignal(createState("t"), signal), [
			"packages/notification/index.ts",
		]);
		const subject = buildReviewTodoSubject(state);
		const description = buildReviewTodoDescription(state);
		expect(subject.startsWith(REVIEW_PREFIX)).toBe(true);
		expect(subject).toContain("code-reviewer");
		expect(description).toContain("Source: code-reviewer");
		expect(description).toContain("packages/notification/index.ts");
	});
});

describe("the review chunks", () => {
	const chunk: ReviewChunk = {
		id: "chunk-1",
		label: "packages/notification (2 files)",
		files: ["packages/notification/index.ts"],
		status: "pending",
	};

	it("names the chunk in the subject of its todo", () => {
		const subject = buildChunkTodoSubject(chunk);
		expect(subject.startsWith(REVIEW_PREFIX)).toBe(true);
		expect(subject).toContain("chunk-1");
		expect(subject).toContain("packages/notification");
	});

	it("belongs to the todo that names it", () => {
		expect(isChunkTodo({ subject: subject(chunk), status: "pending" }, chunk)).toBe(true);
		// "chunk-1" must not match "chunk-10".
		expect(isChunkTodo({ subject: "[REVIEW] chunk-10: other", status: "pending" }, chunk)).toBe(
			false,
		);
		// An implementation todo never belongs to a chunk.
		expect(
			isChunkTodo({ subject: "[IMPLEMENT] chunk-1: other", status: "pending" }, chunk),
		).toBe(false);
	});

	it("is done when its todo is completed", () => {
		const state = startReview(createState("t"), [chunk]);
		const synced = syncChunkStatus(state, [
			{ subject: buildChunkTodoSubject(chunk), status: "completed" },
		]);
		expect(synced.chunks[0].status).toBe("done");
	});

	it("keeps the progress when the todo list is empty", () => {
		const state = startReview(createState("t"), [{ ...chunk, status: "done" }]);
		const synced = syncChunkStatus(state, []);
		expect(synced.chunks[0].status).toBe("done");
	});
});

/** A state that waits for the validation of the test items. */
function testPendingState() {
	const reviewed = startReview(createState("t"), [
		{ id: "chunk-1", label: "a", files: ["a.ts"], status: "done" },
	]);
	return transitionToTestPending(reviewed);
}

/** The subject of the todo of a chunk. */
function subject(chunk: ReviewChunk): string {
	return buildChunkTodoSubject(chunk);
}

describe("the status line", () => {
	it("names the phase and the progress of the implementation", () => {
		const state = createState("t");
		const view = buildPhaseView(state, [
			{ subject: "[IMPLEMENT] one", status: "completed" },
			{ subject: "[IMPLEMENT] two", status: "pending" },
		]);
		expect(formatPhaseStatus(state, view)).toBe("[P] IMPLEMENT | 1/2");
	});

	it("names the chunks and the files of the review", () => {
		const state = startReview(createState("t"), [
			{ id: "chunk-1", label: "a", files: ["a.ts"], status: "done" },
			{ id: "chunk-2", label: "b", files: ["b.ts"], status: "pending" },
		]);
		const view = buildPhaseView(state, []);
		expect(formatPhaseStatus(state, view)).toBe("[R] REVIEW | 1/2 chunks | 0 files");
	});

	it("names the validation of the test phase", () => {
		const state = testPendingState();
		const view = buildPhaseView(
			state,
			[{ subject: "[TEST] the pilot", status: "pending" }],
			{ available: true, pendingFinalTier: 0, failedFinalTier: 0, incompletePlan: 0 },
		);
		expect(formatPhaseStatus(state, view)).toBe("[T] TEST | 0/1 | validation passed");
	});

	it("never claims a validation that could not be read", () => {
		const state = testPendingState();
		const view = buildPhaseView(state, [], {
			available: false,
			pendingFinalTier: 0,
			failedFinalTier: 0,
			incompletePlan: 0,
		});
		expect(formatPhaseStatus(state, view)).toContain("validation unknown");
		expect(formatPhaseStatus(state, view)).not.toContain("passed");
	});

	it("names the children that really ran", () => {
		const state = createState("t");
		const view = buildPhaseView(state, [], undefined, { dispatched: 2, groups: 3 });
		expect(formatPhaseStatus(state, view)).toBe("[P] IMPLEMENT | 0/0 | delegated 2/3");
	});

	it("says nothing about a delegation that has no groups", () => {
		const state = createState("t");
		const view = buildPhaseView(state, [], undefined, { dispatched: 0, groups: 0 });
		expect(formatPhaseStatus(state, view)).not.toContain("delegated");
	});

	it("is plain ASCII", () => {
		const state = createState("t");
		const line = formatPhaseStatus(state, buildPhaseView(state, []));
		expect(/^[\x20-\x7e]+$/.test(line)).toBe(true);
	});
});
