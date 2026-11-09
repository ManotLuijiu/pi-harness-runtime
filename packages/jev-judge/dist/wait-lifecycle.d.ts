/**
 * The lifecycle of a wait for a human answer.
 *
 * The harness asks a human a question and waits. When the wait is over the
 * question is decided once - by the human, by Jev, or not at all. This
 * module owns that lifecycle:
 *
 *     waiting -> evaluating -> decided | human_required | evaluation_error
 *
 * It owns the request the wait belongs to, the session it was asked in, the
 * moment the question was asked, the cancellation and the countdown. The
 * countdown and the decision are measured from that one timestamp, so the
 * time that reaches the evaluation is the same time the countdown shows.
 *
 * The rules that matter:
 *
 * - One evaluation per request. A decision to wait ends the automatic
 *   attempt: the work pauses and a human is needed. Another attempt would
 *   be a second evaluation of the same question, and it is what turned a
 *   five minute wait into a repeating countdown.
 * - A provider failure is an evaluation error, not a decision. It never
 *   becomes "Jev decided to wait": the two mean different things to the
 *   reader of the log and to the work.
 * - Every late result is discarded. An evaluation that finishes after the
 *   question was answered, replaced or the session changed must not change
 *   anything: the state belongs to the request that is still waiting.
 */
import type { DecisionOutcome, DecisionScope } from "./auto-continue.js";
/**
 * The state of a wait.
 *
 * - `idle`: nothing is waiting.
 * - `waiting`: a question waits for a human answer.
 * - `evaluating`: the decision of the question is running.
 * - `decided`: Jev decided; the outcome says what the work does.
 * - `human_required`: the decision needs a human; the work is blocked.
 * - `evaluation_error`: the evaluation failed; no decision was made.
 */
export type WaitLifecycleState = "idle" | "waiting" | "evaluating" | "decided" | "human_required" | "evaluation_error";
/** The question a wait is about. */
export interface WaitRequest {
    /** The canonical request ID of the question. */
    requestId: string;
    /** The session the question was asked in. */
    sessionId: string;
    /** The kind of the question ("approval", "choice", ...). */
    kind?: string;
    /** The typed ask of the question. */
    askType?: string;
    /** The text of the question. */
    text?: string;
    /** The message the question was detected in. */
    contextText?: string;
    /** The concrete alternatives of a choice question. */
    alternatives?: string[];
    /**
     * What the question is about.
     *
     * The relevance decides whether the wait may reach the judge at all: an
     * offer of work that was not asked for is never decided by silence.
     */
    relevance?: string;
}
/** The result of one evaluation. */
export interface WaitEvaluation {
    /** The outcome of the decision. */
    outcome: DecisionOutcome;
    /** The option the evaluation selected for a choice question. */
    selectedOption?: string;
    /** The scope the evaluation selected. */
    scope?: DecisionScope;
    /** The reasoning of the decision. */
    reasoning: string;
    /** The policy rule that changed the outcome, when one did. */
    policyApplied?: string;
    /** The risk level the evaluation gave the action. */
    riskLevel?: string;
    /**
     * The evaluation failed.
     *
     * A failed evaluation is not a decision: it says nothing about the
     * action, so it must never be recorded as "Jev decided to wait".
     */
    error?: {
        kind: "provider" | "unknown";
        message: string;
    };
    /**
     * The request the evaluation was made for.
     *
     * The controller stamps it: a decision belongs to the request it was
     * evaluated for, and to no other request. A result that arrives after
     * its request was answered, replaced or cancelled must never be
     * applied to the request that happens to be current when the result is
     * applied.
     */
    requestId?: string;
    /**
     * The session the evaluation was made in.
     *
     * The controller stamps it for the same reason: a decision of one
     * session is not a decision of another.
     */
    sessionId?: string;
}
/**
 * The countdown of the wait.
 *
 * The controller owns the countdown; the implementation owns the display.
 * The deadline is derived from the moment the question was asked, so the
 * countdown and the decision can never drift apart.
 */
export interface WaitCountdown {
    /** Start the countdown of a request (or replace the running one). */
    start(requestId: string, startedAt: number): void;
    /** Release the countdown. */
    stop(): void;
    /** Is the countdown running? */
    readonly active: boolean;
}
/** What the controller reports about a state change. */
export interface WaitStateDetail {
    /** The request the state belongs to. */
    requestId: string | null;
    /** The state that was reached. */
    state: WaitLifecycleState;
    /** The decision, when the state was reached by one. */
    evaluation?: WaitEvaluation;
    /** The reason of the state, in words. */
    reason: string;
}
/** The dependencies of the controller. */
export interface WaitLifecycleDeps {
    /** The clock. The tests drive it. */
    now?: () => number;
    /** The countdown of the wait. */
    countdown?: WaitCountdown;
    /** The minutes the question waits for a human answer. */
    waitMinutes: number;
    /** The session the runtime is in. The tests drive it. */
    currentSessionId?: () => string | null;
    /** The evaluation of one request. */
    evaluate: (request: WaitRequest, waitedMs: number) => Promise<WaitEvaluation>;
    /** The state of the wait changed. */
    onState?: (state: WaitLifecycleState, detail: WaitStateDetail) => void;
    /**
     * Is the wait still eligible for an automatic decision?
     *
     * The owner of the wait answers: it knows the state of the work and the
     * relevance of the question. The controller asks before it evaluates,
     * so an obsolete wait never reaches the judge.
     */
    eligibility?: () => Promise<{
        eligible: boolean;
        reason: string;
    }> | {
        eligible: boolean;
        reason: string;
    };
    /** A failure of the controller itself. */
    onError?: (error: unknown) => void;
}
/** Why an evaluation was not applied. */
export type WaitDiscardReason = "no-request" | "not-waiting" | "not-due" | "not-eligible" | "stale" | "other-session";
/** What the controller did with an evaluation. */
export interface WaitLifecycleResult {
    /** Did the evaluation change the state? */
    applied: boolean;
    /** The state of the wait afterwards. */
    state: WaitLifecycleState;
    /** The decision, when there was one. */
    evaluation?: WaitEvaluation;
    /** The reason, in words. */
    reason: string;
    /** Why the evaluation was not applied, when it was not. */
    discardReason?: WaitDiscardReason;
}
/**
 * The controller of a wait for a human answer.
 *
 * The controller owns the lifecycle of one question at a time: a new
 * question replaces the old one, an answer ends the wait, and a late result
 * of an older request is discarded.
 */
export declare class WaitLifecycleController {
    private readonly deps;
    private readonly now;
    private state;
    private request;
    private questionAt;
    /**
     * Bumped on every change of the request.
     *
     * A result of an older generation belongs to a request that is gone: it
     * is discarded instead of changing the state of the new one.
     */
    private generation;
    constructor(deps: WaitLifecycleDeps);
    /** The state of the wait. */
    get currentState(): WaitLifecycleState;
    /** The request the wait belongs to. */
    get currentRequestId(): string | null;
    /** The session the waiting question was asked in. */
    get currentSessionId(): string | null;
    /** The moment the question was asked (in milliseconds). */
    get questionAskedAt(): number | null;
    /** Is the wait about this request? */
    owns(requestId: string | undefined | null): boolean;
    /**
     * Does this evaluation belong to the request that waits?
     *
     * The evaluation carries the identity of the request it was made for.
     * A result of a request that was answered, replaced or cancelled is
     * stale: it must not be applied to the request that is current now,
     * because that request is a different question with its own decision.
     *
     * An evaluation without an identity belongs to nothing and is stale by
     * default: the answer to "may I apply this?" is then "no".
     */
    ownsEvaluation(evaluation: WaitEvaluation): boolean;
    /** The milliseconds since the question was asked. */
    elapsedMs(): number;
    /**
     * The minutes since the question was asked.
     *
     * This is the one elapsed time: the countdown, the evaluation and the
     * fallback of the judge all measure the same wait.
     */
    waitedMinutes(): number;
    /** Is the deadline of the decision reached? */
    isDue(): boolean;
    /**
     * A question was asked: the wait starts.
     *
     * A question that replaces another one invalidates the evaluation of
     * the old one: the generation is bumped, so a late result of the old
     * request cannot change the state of the new one.
     */
    begin(request: WaitRequest): void;
    /**
     * The question was answered by a human: the wait is over.
     *
     * The evaluation of that request - if it is still running - is
     * invalidated: its result belongs to a question that has an answer.
     */
    answer(requestId: string): void;
    /**
     * The session changed: the wait belongs to a session that is gone.
     */
    invalidate(reason: string): void;
    /** The wait is over for any reason. */
    cancel(): void;
    /**
     * The deadline is reached: evaluate the current request once.
     *
     * The evaluation runs only when the wait is still waiting, the deadline
     * is reached and the session is the one the question was asked in. A
     * second call - the countdown and the fallback poll can both arrive -
     * does nothing: the state is no longer "waiting".
     */
    evaluateDue(): Promise<WaitLifecycleResult>;
    /** End the wait: the request is gone and the countdown is released. */
    private end;
    /** Report a state change. */
    private setState;
    /** Report a failure without letting the report become a new failure. */
    private report;
}
//# sourceMappingURL=wait-lifecycle.d.ts.map