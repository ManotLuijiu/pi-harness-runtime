import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TodoItem } from "./todo-provider.js";
/**
 * Continuation configuration
 */
export interface ContinuationConfig {
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
    lastSteerMessage: string | null;
    steerAttempts: number;
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
    private pi;
    private config;
    private todoProvider;
    private state;
    constructor(pi: ExtensionAPI, config?: ContinuationConfig);
    /**
     * Register lifecycle hooks
     */
    register(): void;
    /**
     * Evaluate continuation decision and execute it
     */
    private evaluateContinuation;
    /**
     * Continue a specific todo item
     */
    private continueItem;
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
    private reset;
    /**
     * Cleanup on shutdown
     */
    private cleanup;
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
 * Create and register a todo continuation controller
 */
export declare function createTodoContinuation(pi: ExtensionAPI, config?: ContinuationConfig): TodoContinuationController;
//# sourceMappingURL=continuation-controller.d.ts.map