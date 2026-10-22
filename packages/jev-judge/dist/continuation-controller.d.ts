import type { TodoItem, TodoContext, TodoProvider } from "./todo-provider.js";
export interface ContinuationConfig {
    /** Dispatch function to send messages to the agent (required) */
    dispatch: (content: string) => Promise<void>;
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
    private _totalAttempts;
    private _maxTotalSteerAttempts;
    private _disposed;
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
     * Resume from explicit pause
     */
    resume(): void;
    /**
     * Get current todo snapshot (exposed for task intake)
     */
    getSnapshot(): Promise<import("./todo-provider.js").TodoSnapshot>;
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
     * Mark a todo item as complete
     */
    markComplete(_itemId: number): Promise<void>;
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