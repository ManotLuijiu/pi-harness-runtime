/**
 * The persisted state of the two-phase workflow.
 *
 * The state survives a restart and a compaction, so the phase, the task start
 * revision, the review scope, the finished chunks and the open findings are
 * never lost.
 */
import type { ReviewChunk, ReviewFinding, ReviewSignal, TwoPhasePhase, TwoPhaseState } from "./types.js";
/** The directory the state files live in. */
export declare const TWO_PHASE_STATE_DIR: string;
/** A fresh state for a task. */
export declare function createState(taskId: string, startRevision?: string | null): TwoPhaseState;
/** Make a file name safe for the file system. */
export declare function safeFileName(taskId: string): string;
/** Repair a state that was read from disk. */
export declare function normalizeState(value: unknown, taskId: string): TwoPhaseState;
/** The state of one task on disk. */
export declare class TwoPhaseStateStore {
    private readonly dir;
    constructor(dir?: string);
    /** The file the state of the task lives in. */
    path(taskId: string): string;
    /**
     * Read the state of the task.
     *
     * `null` means that there is no state. A state that exists but cannot be
     * read is an error: it must not be mistaken for a fresh task, because that
     * would lose the revision the task started at and the progress of the
     * review.
     */
    read(taskId: string): TwoPhaseState | null;
    /**
     * Write the state of the task.
     *
     * A failing write is reported to the caller: the runtime decides whether
     * the session may continue without the state, the test sees the reason.
     */
    write(state: TwoPhaseState): TwoPhaseState;
    /** Remove the state of the task. */
    clear(taskId: string): void;
}
/** Move to a phase, never backwards. */
export declare function moveToPhase(state: TwoPhaseState, phase: TwoPhasePhase): TwoPhaseState;
/** Record a review signal. The phase does not change. */
export declare function recordSignal(state: TwoPhaseState, signal: ReviewSignal): TwoPhaseState;
/** The implementation is done: the review waits for its scope. */
export declare function transitionToReviewPending(state: TwoPhaseState, scopeFiles: string[]): TwoPhaseState;
/** The review starts with the given chunks. */
export declare function startReview(state: TwoPhaseState, chunks: ReviewChunk[]): TwoPhaseState;
/** Mark a review chunk as finished. */
export declare function markChunkDone(state: TwoPhaseState, chunkId: string): TwoPhaseState;
/** Record a confirmed finding. */
export declare function recordFinding(state: TwoPhaseState, finding: ReviewFinding): TwoPhaseState;
/**
 * The review found something: the fixes are now the work.
 *
 * The fixes start when the review is finished: a fix phase before the review
 * ran would hide the work that is still open.
 */
export declare function transitionToReviewFixes(state: TwoPhaseState): TwoPhaseState;
/** Every chunk is finished. */
export declare function allChunksDone(state: TwoPhaseState): boolean;
/**
 * The work is finished.
 *
 * The task is only complete when the review ran over every chunk. The
 * implementation phase never completes the task on its own.
 */
export declare function markComplete(state: TwoPhaseState): TwoPhaseState;
/** Is a review queued? */
export declare function hasQueuedReview(state: TwoPhaseState): boolean;
//# sourceMappingURL=state.d.ts.map