import type { TodoHistoryEntry, TodoItem, TodoContext, TodoProvider } from "./todo-provider.js";
import { type ValidationBudgetStatus } from "./validation-plan.js";
import type { ValidationLedger } from "./validation-ledger.js";
/**
 * The context of an advisory message.
 *
 * The fields are known: they name the reason of the advisory and the
 * generation of the request it belongs to.
 */
export interface AdvisoryMeta {
    /** The reason of the advisory, in the vocabulary of its source. */
    reason?: string;
    /** The generation of the request the advisory belongs to. */
    requestGeneration?: string;
}
export interface ContinuationConfig {
    /** Dispatch function to send messages to the agent (required) */
    dispatch: (content: string) => Promise<void>;
    /**
     * The dispatch of an advisory message.
     *
     * An advisory is not the continuation of a task: it is an observation
     * that the caller wants the agent to see. It goes through the same
     * guards as a continuation, so it never forces a turn.
     *
     * Without this hook the advisory uses the ordinary dispatch.
     */
    advisoryDispatch?: (content: string, meta?: AdvisoryMeta) => Promise<void>;
    /** Minimum wait before Jev fallback (ms) */
    jevFallbackMinWaitMs?: number;
    /** Threshold for routine continuation */
    routineThreshold?: number;
    /** Max steer attempts per session */
    maxSteerAttempts?: number;
    /** Enable Jev for ambiguous cases */
    enableJev?: boolean;
    /** Injectable todo provider (defaults to the pi-backed provider) */
    todoProvider?: TodoProvider;
    /**
     * How long a dispatched continuation may stay "queued" before the guard is
     * released automatically. Guards are normally released when the agent turn
     * settles; this is the safety net for a lost settle event.
     */
    guardReleaseTimeoutMs?: number;
    /**
     * How long the guard stays armed after a guard release was DROPPED
     * (it arrived while a dispatch was on the wire). Without this the guard
     * would stay armed for the full `guardReleaseTimeoutMs` safety net and
     * the auto-continue would stall for minutes.
     */
    guardReleaseAfterDropMs?: number;
    /**
     * Max successful dispatches per session across all items.
     *
     * The per-item budget (`maxSteerAttempts`) is reset when the work item
     * changes, so alternating between two items would never exhaust it. This
     * session-wide cap bounds such a run.
     */
    maxTotalSteerAttempts?: number;
    /**
     * How long the circuit breaker stays open after repeated send failures.
     *
     * After the cooldown a single trial dispatch is allowed again.
     */
    circuitBreakerCooldownMs?: number;
    /**
     * How many consecutive send failures open the circuit breaker.
     */
    maxConsecutiveFailures?: number;
    /**
     * How long a dispatch may stay on the wire before the in-flight guard is
     * force-released.
     *
     * A dispatch that never settles must not block every later continuation.
     */
    inFlightTimeoutMs?: number;
    /**
     * Ledger of validation runs.
     *
     * When a ledger is wired, the controller knows which tier already ran and
     * whether the final tier is still pending, and it can pause an item whose
     * declared time budget is spent.
     */
    validationLedger?: ValidationLedger;
}
/**
 * Continuation state
 */
export interface ContinuationState {
    sessionId: string;
    generation: number;
    todoRevision: number;
    currentItemId: number | null;
    nextItemId: number | null;
    lastMessageId: string | null;
    continuationQueued: boolean;
    userPaused: boolean;
    explicitPause: boolean;
    /**
     * The number of pauses of this request.
     *
     * The epoch says which pause is the current one. A pause that belongs
     * to a refusal of the judge is not the pause the user set afterwards,
     * and only the epoch tells the two apart.
     */
    pauseEpoch: number;
    /**
     * The epoch of the explicit pause.
     *
     * The explicit pause and the temporary pause are two pauses, and each
     * of them has its own epoch: a temporary pause that came after an
     * explicit one is the newer pause, and it is the one that is active.
     */
    explicitPauseEpoch: number;
    /** The epoch of the temporary pause. */
    tempPauseEpoch: number;
    lastSteerMessage: string | null;
    steerAttemptsForCurrentItem: number;
    lastItemContinued: number | null;
    lastEvaluationResult: string | null;
}
/**
 * Outcome of a steer attempt
 */
export interface SteerResult {
    /** True when the continuation message was actually handed to the agent */
    dispatched: boolean;
    /** Why the dispatch was skipped (only set when dispatched is false) */
    reason?: string;
    /** Attempt counter for the item (successful dispatches only) */
    attempts: number;
    /** Number of dispatches that were blocked by a guard */
    blockedDispatches: number;
}
/**
 * Result of a guarded dispatch.
 *
 * `blocked` distinguishes the two reasons a dispatch does not happen:
 * a guard skipped it (session busy, paused, duplicate, item completed) or
 * the send itself failed. A blocked dispatch is counted separately and never
 * consumes the attempt budget.
 */
export interface GuardedDispatchResult {
    /** True when the continuation message was actually handed to the agent */
    dispatched: boolean;
    /** Why the dispatch did not happen (only set when dispatched is false) */
    reason?: string;
    /** True when a guard skipped the dispatch, false when the send itself failed */
    blocked: boolean;
}
/**
 * Continuation result
 */
export interface ContinuationResult {
    action: "continue" | "stop" | "blocked" | "ask";
    nextItemId?: number;
    question?: string;
    reason?: string;
    /** Budget status of the item the decision was about. */
    budget?: ValidationBudgetStatus;
}
/**
 * Todo-Driven Continuation Controller
 *
 * Evaluates todo state on agent_settled and determines next action.
 */
export declare class TodoContinuationController {
    private ctx;
    private config;
    private todoProvider;
    /**
     * How long a dispatched continuation may stay queued before the guard is
     * released automatically (safety net for a lost agent_settled event).
     */
    private guardReleaseTimeoutMs;
    /** Delay before the guard is released after a dropped mid-dispatch release */
    private guardReleaseAfterDropMs;
    private state;
    /**
     * A fresh epoch for a pause.
     *
     * The counter belongs to the process, not to a controller: an epoch of
     * one session must never be the epoch of another one, or a pause of
     * the new session would look like the pause of an old refusal.
     */
    private _nextPauseEpoch;
    private _inFlightSeq;
    private _dispatchSeq;
    private _guardTimer;
    private _blockedDispatches;
    private _pendingGuardRelease;
    private _cancelRequested;
    private _lastDroppedGuardRelease;
    private _stalledItemId;
    private _consecutiveFailures;
    private _maxConsecutiveFailures;
    private _lastFailureAt;
    private _circuitBreakerCooldownMs;
    private _inFlightTimeoutMs;
    private _attemptsByItem;
    private _itemStartedAt;
    private _totalAttempts;
    private _maxTotalSteerAttempts;
    private _disposed;
    private _validationLedger?;
    /** The session and generation the reconciliation block was last sent for */
    private _reconciliationSentFor;
    /** True when a reconciliation was requested for the current generation */
    private _reconciliationRequested;
    /** True while a dispatch is on the wire */
    private get inFlight();
    constructor(ctx: TodoContext, config?: ContinuationConfig);
    /**
     * Successful dispatches recorded for an item.
     *
     * The budget is per item: switching to a different item starts a fresh
     * budget for that item, but the session-wide cap (`maxTotalSteerAttempts`)
     * still bounds an alternating run.
     */
    private attemptsFor;
    /**
     * Elapsed work time on an item, measured from the first continuation.
     *
     * `undefined` means the item was never continued, so no elapsed time can
     * be reported yet.
     */
    private elapsedForItem;
    /**
     * Remember when work on an item started (first continuation only).
     */
    private markItemStarted;
    /**
     * The validation state of an item, read from the ledger.
     *
     * `undefined` when no ledger is wired: the caller then falls back to the
     * declared plan alone.
     */
    private validationStateFor;
    /**
     * The key of the current request: the session and the generation.
     *
     * A new request (a new generation) asks for the reconciliation again.
     */
    private reconciliationKey;
    /**
     * The reconciliation block for the open items of the list.
     *
     * The block is empty when nothing is open, and it is not repeated for the
     * same generation: a reminder that is repeated on every continuation is a
     * reminder nobody reads. A requested reconciliation (an item that was
     * reported complete while it is still open) asks again.
     */
    private reconciliationBlockFor;
    /**
     * The budget status of an item.
     *
     * Only a declared `budgetMinutes` arms a budget - the harness never
     * invents one, because an invented budget could pause legitimate work.
     */
    private budgetStatusFor;
    /**
     * The reason reported when an item ran out of its declared time budget.
     */
    private budgetAbortReason;
    /**
     * True while the circuit breaker forbids a send.
     *
     * After the cooldown a single trial dispatch is allowed again, so a
     * transient transport outage does not stop auto-continue forever.
     */
    private breakerOpen;
    /**
     * Check if continuation is allowed (not paused, session idle)
     */
    private canContinue;
    /**
     * User explicitly paused - only this clears on explicit resume
     */
    explicitPause(): void;
    /**
     * Whether the user paused the work explicitly.
     *
     * Only an explicit resume clears the pause. The harness reads the state
     * before it injects a resume: the injected message is a resume, and a
     * resume that ignores a pause overrides the decision of the user.
     */
    isExplicitlyPaused(): boolean;
    /**
     * The epoch of the current pause.
     *
     * The epoch counts the pauses of the request. A caller that paused the
     * work itself remembers the epoch it got, and it compares it later: a
     * pause that came after is not the pause it set, and the approval of
     * the human must not clear it.
     *
     * The current pause is the newest pause that is still active. A
     * temporary pause is cleared by the next decision, and the explicit
     * pause of a refusal is then the current one again.
     */
    pauseEpoch(): number;
    /**
     * The pause of the work and the epoch of that pause.
     *
     * The two flags are one pause for the caller: a temporary pause of the
     * user is a pause too, and an approval of the human must not clear it.
     */
    pauseState(): {
        paused: boolean;
        pauseEpoch: number;
    };
    /**
     * Resume from explicit pause
     */
    resume(): void;
    /**
     * Get current todo snapshot (exposed for task intake)
     */
    getSnapshot(): Promise<import("./todo-provider.js").TodoSnapshot>;
    /**
     * The error of the last read of the list, when the read failed.
     *
     * A read that failed answers with an empty list, so the error is the
     * only evidence that the list is unknown rather than empty.
     */
    get lastError(): string | null;
    /**
     * The history of the todo list: the state after every change.
     *
     * The list says what the work is now. The history says what a request
     * touched, also when the item is back in the state it had before: a
     * todo that was reopened and finished again is work of the request
     * that did it.
     */
    getHistory(): Promise<TodoHistoryEntry[]>;
    /**
     * Temporary pause for user input processing
     * Does not require explicit resume
     */
    tempPause(): void;
    /**
     * Clear continuation queue (called when work completes or starts)
     */
    clearQueue(): void;
    /**
     * Release the dispatch guard after a verified lifecycle transition.
     *
     * The guard is set when a continuation is handed to the agent and must be
     * released once that turn has settled - otherwise every later dispatch is
     * blocked while the attempt budget keeps being consumed.
     */
    releaseContinuationGuard(reason?: string): void;
    /** Cancel the automatic guard-release timer */
    private cancelGuardTimer;
    /** Schedule an automatic guard release (safety net for a lost settle event) */
    private scheduleGuardRelease;
    /**
     * Public method to evaluate and execute continuation
     * Called by external handlers (e.g., agent_settled)
     * Checks blockers and pause BEFORE selecting a task
     */
    decide(): Promise<ContinuationResult>;
    /**
     * Continue a specific todo item
     *
     * Routed through the guarded dispatch so the in-flight guard, the
     * duplicate-queue guard and the guard-release timer behave exactly like
     * they do for an automatic continuation. A blocked or failed dispatch
     * never consumes the attempt budget.
     */
    continueItem(item: TodoItem): Promise<void>;
    /**
     * Record a successful dispatch against the per-item and session budgets.
     */
    private recordAttempt;
    /**
     * Guarded dispatch - checks all conditions before sending
     * Uses in-flight guard to prevent race conditions
     *
     * The message is built by `buildMessage` at the moment the dispatch is
     * about to send, so the payload always reflects the state at that moment
     * (and the item comes from the snapshot read this dispatch already does).
     */
    private guardedDispatch;
    /**
     * Steer to continue a todo item
     *
     * The attempt budget is only consumed by dispatches that actually reached
     * the agent. Dispatches blocked by a guard are counted separately so a
     * blocked attempt can never exhaust the retry budget.
     */
    steerToContinue(itemId: number): Promise<SteerResult>;
    /**
     * Dispatch an advisory message through the guarded path.
     *
     * An advisory is an observation, not the continuation of a task. It goes
     * through the same guards as a continuation: a pause, a pending user
     * message, a busy session, a queued dispatch, a cancelled dispatch and
     * an open circuit breaker all stop it. The advisory therefore never
     * forces a turn.
     *
     * The task-completion safeguard holds as well: when the task of the
     * request is completed, the advisory is not delivered.
     *
     * An advisory does not consume the attempt budget of a task: it is not
     * a continuation of one.
     */
    dispatchAdvisory(message: string, options?: {
        /** The task of the request. The advisory is not delivered when it is done. */
        itemId?: number;
        /** The context of the advisory. It reaches the dispatch, never the state. */
        meta?: AdvisoryMeta;
    }): Promise<GuardedDispatchResult>;
    /**
     * Mark a todo item as complete.
     *
     * The controller never closes a todo by itself: the read confirms that the
     * agent closed the item with the real todo tool. An item that is still
     * open means the work is not finished: the internal state stays, the
     * reconciliation is requested and the normal continuation continues the
     * item.
     */
    markComplete(itemId: number): Promise<void>;
    /**
     * User paused
     */
    pause(): void;
    /**
     * Reset state for new session
     */
    _reset(): void;
    /**
     * Cleanup on shutdown
     */
    _cleanup(): void;
    /**
     * Public shutdown hook (used by the host on session shutdown).
     *
     * Releases the guard timer and the queue so a stopped session never keeps
     * a timer alive or blocks a later continuation.
     */
    dispose(): void;
    /**
     * Get current state summary
     *
     * The item ids are reported as ids - the full TodoItem is only available
     * from the (asynchronous) provider snapshot, so no partial object is
     * presented as a TodoItem.
     */
    getState(): {
        current: {
            id: number;
        } | null;
        next: {
            id: number;
        } | null;
    };
    /**
     * Full controller state (for diagnostics and tests)
     */
    getDiagnostics(): {
        continuationQueued: boolean;
        inFlight: boolean;
        steerAttemptsForCurrentItem: number;
        blockedDispatches: number;
        consecutiveFailures: number;
        circuitBreakerOpen: boolean;
        totalAttempts: number;
        lastItemContinued: number | null;
        lastSteerMessage: string | null;
        explicitPause: boolean;
        userPaused: boolean;
        pauseEpoch: number;
        pendingGuardRelease: string | null;
        lastDroppedGuardRelease: string | null;
        cancelRequested: boolean;
        disposed: boolean;
    };
}
/**
 * Create a todo continuation controller
 * Note: Caller is responsible for registering event handlers with the proper context
 */
export declare function createTodoContinuation(ctx: TodoContext, config?: ContinuationConfig): TodoContinuationController;
//# sourceMappingURL=continuation-controller.d.ts.map