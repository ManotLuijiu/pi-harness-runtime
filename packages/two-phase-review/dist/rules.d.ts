/**
 * The workflow rules.
 *
 * The rules are injected into the system prompt: they tell the agent how the
 * two phases are separated and what it has to do in the current phase.
 */
import type { ReviewChunk, ReviewSignal, TwoPhasePhase, TwoPhaseState } from "./types.js";
import { type TodoLike } from "./classify.js";
/** The contract of the workflow. */
export declare const TWO_PHASE_CONTRACT = "## Two-phase implementation and review\n\nA task with several steps runs in two phases.\n\n### Phase 1 - implementation\n- Work through every open implementation todo of the current request.\n- Do not start a comprehensive review between implementation todos. A review that is requested while the implementation runs is queued, not executed.\n- Keep the task-level checks active: syntax errors, broken imports, type errors of the code you write right now and failing required tests are part of the implementation and are fixed now.\n- Broader feedback (style, maintainability, a full diff review) is queued as one [REVIEW] todo. Never discard it.\n- Queued review work is not an implementation blocker. The request is not complete while implementation todos remain.\n\n### Phase 2 - review\n- The review covers the diff of the task, not the whole repository.\n- Review the scope in chunks, per module. Use independent reviewers for independent chunks.\n- Record every confirmed finding as a [REVIEW-FIX] todo, grouped by root cause and severity. A minor suggestion does not interrupt a running chunk.\n- Fix the confirmed findings after the review pass, check the changed area, and run one final integration review over the task diff.\n- The request is complete only when the implementation todos, the review chunks and the required fix todos are done or explicitly accepted.\n\n### Todo prefixes\n- [IMPLEMENT] implementation work of the current request\n- [REVIEW] the queued review of the task diff\n- [REVIEW-FIX] a confirmed finding that has to be fixed\n\nA user pause, an approval requirement, a security issue or any other safety rule stops the work immediately. The phase order never overrides the intent of the user.";
/** The current state of the workflow as the agent sees it. */
export interface PhaseView {
    phase: TwoPhasePhase;
    /** How many implementation todos are still open. */
    implementationOpen: number;
    /** How many review todos are open. */
    reviewOpen: number;
    /** How many review-fix todos are open. */
    reviewFixOpen: number;
    /** How many files the review covers. */
    scopeFiles: number;
    /** The review chunks and their state. */
    chunks: {
        id: string;
        label: string;
        status: string;
    }[];
    /** Is a review queued? */
    queued: boolean;
    /** The signals that queued the review. */
    signals: ReviewSignal[];
}
/** Build the phase view from the state and the todo list. */
export declare function buildPhaseView(state: TwoPhaseState, todos: TodoLike[]): PhaseView;
/** The subject of the one queued review todo. */
export declare function buildReviewTodoSubject(state: TwoPhaseState): string;
/** The description of the one queued review todo. */
export declare function buildReviewTodoDescription(state: TwoPhaseState): string;
/**
 * The status line of the workflow.
 *
 * The line is plain ASCII: it is shown in the footer of the session.
 */
export declare function formatPhaseStatus(state: TwoPhaseState): string;
/**
 * The subject of the todo that covers one review chunk.
 *
 * The chunk id is part of the subject, so the runtime can tell which chunk a
 * todo belongs to.
 */
export declare function buildChunkTodoSubject(chunk: ReviewChunk): string;
/** The description of the todo that covers one review chunk. */
export declare function buildChunkTodoDescription(chunk: ReviewChunk): string;
/** Does the todo item belong to the review chunk? */
export declare function isChunkTodo(todo: TodoLike, chunk: ReviewChunk): boolean;
/**
 * Derive the status of the review chunks from the todo list.
 *
 * The status only moves forward: a chunk that is done stays done, so a todo
 * list that is briefly empty (a restart, a compaction) can never erase the
 * progress of the review.
 */
export declare function syncChunkStatus(state: TwoPhaseState, todos: TodoLike[]): TwoPhaseState;
/**
 * The reason a comprehensive review was deferred.
 *
 * The reason has to be actionable: the agent continues with the
 * implementation and keeps the task-level checks alive.
 */
export declare function buildDeferralReason(state: TwoPhaseState, context: {
    source: string;
    implementationOpen: number;
}): string;
/**
 * The instruction for the current phase.
 *
 * The instruction is short: it names the phase, the open work and what the
 * agent has to do next.
 */
export declare function buildPhaseInstruction(state: TwoPhaseState, view: PhaseView): string;
//# sourceMappingURL=rules.d.ts.map