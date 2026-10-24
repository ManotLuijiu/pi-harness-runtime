/**
 * Types of the two-phase implementation and review workflow.
 *
 * The workflow keeps two phases apart: the implementation of the requested
 * work (Phase 1) and the comprehensive review of that work (Phase 2). A
 * review signal that arrives during Phase 1 is recorded, never executed.
 */
/** The phase the task currently is in. */
export type TwoPhasePhase = "implementation" | "review_pending" | "review" | "review_fixes" | "complete";
/** What a todo item represents. */
export type TodoKind = "implement" | "review" | "review_fix" | "other";
/** A "review now" signal that arrived while the implementation was running. */
export interface ReviewSignal {
    /** Who raised the signal (tool name, agent name, command). */
    source: string;
    /** The files the signal points at (best effort). */
    files: string[];
    /** Why the signal was raised, in one short line. */
    reason: string;
    /** ISO timestamp of the signal. */
    at: string;
}
/** One review unit: a logical scope of the task diff. */
export interface ReviewChunk {
    id: string;
    label: string;
    files: string[];
    status: "pending" | "done";
}
/** A confirmed finding of the review. */
export interface ReviewFinding {
    id: string;
    severity: "low" | "medium" | "high";
    summary: string;
    chunkId?: string;
    /** A finding the user accepted as a known issue. */
    accepted?: boolean;
    at: string;
}
/** The persisted state of the workflow for one task. */
export interface TwoPhaseState {
    phase: TwoPhasePhase;
    /** The task the state belongs to (the session id). */
    taskId: string;
    /** The revision the task started at: the review scope is the diff since then. */
    startRevision: string | null;
    /** The files the review covers. */
    scopeFiles: string[];
    /** The review chunks the scope was split into. */
    chunks: ReviewChunk[];
    /** Every review signal that was recorded (deduplicated). */
    signals: ReviewSignal[];
    /** The findings the review produced. */
    findings: ReviewFinding[];
    /** The subject of the queued review todo (one item, not many). */
    reviewTodoSubject?: string;
    /** The description of the queued review todo. */
    reviewTodoDescription?: string;
    /** ISO timestamp of the last write. */
    updatedAt: string;
}
//# sourceMappingURL=types.d.ts.map