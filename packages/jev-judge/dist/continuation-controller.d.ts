import type { TodoItem, TodoContext } from "./todo-provider.js";
/**
 * Continuation configuration
 */
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
    private state;
    private _inFlight;
    constructor(ctx: TodoContext, config?: ContinuationConfig);
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
     * Public method to evaluate and execute continuation
     * Called by external handlers (e.g., agent_settled)
     * Checks blockers and pause BEFORE selecting a task
     */
    decide(): Promise<ContinuationResult>;
    /**
     * Continue a specific todo item
     */
    continueItem(item: TodoItem): Promise<void>;
    /**
     * Guarded dispatch - checks all conditions before sending
     * Uses in-flight guard to prevent race conditions
     */
    private guardedDispatch;
    /**
     * Steer to continue a todo item
     */
    steerToContinue(itemId: number): Promise<void>;
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
     * Get current state summary
     */
    getState(): {
        current: TodoItem | null;
        next: TodoItem | null;
        ready: number;
    };
}
/**
 * Create a todo continuation controller
 * Note: Caller is responsible for registering event handlers with the proper context
 */
export declare function createTodoContinuation(ctx: TodoContext, config?: ContinuationConfig): TodoContinuationController;
//# sourceMappingURL=continuation-controller.d.ts.map