/**
 * Todo-Driven Continuation Controller
 *
 * Executes authorized todo items without repeated prompts.
 * Uses deterministic rules + optional Jev for ambiguous cases.
 *
 * Architecture:
 * A. Read real todo state (not bd)
 * B. Deterministic continuation on agent_settled
 * C. Jev for ambiguous classification only
 * D. Single continuation controller
 * E. Update prompts/Telegram/status together
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type TodoItem } from "./todo-provider.js";
/**
 * Continuation controller configuration
 */
interface ContinuationConfig {
    /** Minimum wait time before Jev fallback (ms) */
    jevFallbackMinWaitMs?: number;
    /** Jev probability threshold for routine continuation */
    routineThreshold?: number;
    /** Max steer attempts before reporting blocker */
    maxSteerAttempts?: number;
    /** Enable Jev classification for ambiguous cases */
    enableJev?: boolean;
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
    private jevJudge?;
    private state;
    constructor(pi: ExtensionAPI, config?: ContinuationConfig);
    /**
     * Register lifecycle hooks
     */
    register(): void;
    /**
     * Evaluate continuation decision
     */
    private evaluateContinuation;
    /**
     * Determine if we should auto-continue
     */
    private shouldAutoContinue;
    /**
     * Steer to continue a todo item
     */
    steerToContinue(itemId: number): Promise<void>;
    /**
     * Mark a todo item as complete
     */
    markComplete(itemId: number): Promise<void>;
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
export {};
//# sourceMappingURL=continuation-controller.d.ts.map