/**
 * Task Intake - Automatic todo capture from user requests
 *
 * Uses Jev Yes/No judgments to determine:
 * - Whether a user request should be tracked as work
 * - Whether it duplicates existing work
 * - Whether it modifies an existing requirement
 */
import type { JevJudgeConfig } from "./types.js";
/**
 * Task intake configuration
 */
export interface TaskIntakeConfig extends JevJudgeConfig {
    /** Minimum noul threshold for capturing as actionable */
    actionableThreshold?: number;
    /** Dispatch function to send messages to the agent */
    dispatch: (content: string) => Promise<void>;
}
/**
 * Result of task intake evaluation
 */
export interface TaskIntakeResult {
    /** Whether the request should be captured as actionable work */
    actionable: boolean;
    /** Probability that it's actionable (0-1) */
    probability: number;
    /** Whether it duplicates existing work */
    isDuplicate: boolean;
    /** Whether it modifies an existing requirement */
    modifiesExisting: boolean;
    /** Recommended action */
    action: "create" | "skip" | "amend" | "investigate";
    /** Existing todo ID if duplicate/modifies */
    existingTodoId?: number;
}
/**
 * Task Intake Controller
 *
 * Evaluates user requests with Jev to determine if they should be
 * captured as todos for automatic tracking.
 */
export declare class TaskIntakeController {
    private jev;
    private config;
    private lastRequest;
    private lastResult;
    private recentCaptures;
    private readonly CAPTURE_COOLDOWN_MS;
    private _pendingEvaluationHash;
    private _stopped;
    constructor(config: TaskIntakeConfig);
    /**
     * Check if Jev is available
     */
    isAvailable(): boolean;
    /**
     * Evaluate a user request for task capture
     */
    evaluate(userMessage: string, existingTodos?: string[]): Promise<TaskIntakeResult>;
    /**
     * Evaluate with actual todo items from continuation controller
     */
    evaluateWithTodos(userMessage: string, controller: {
        getSnapshot: () => Promise<{
            items: Array<{
                id: number;
                subject: string;
                status: string;
            }>;
        }>;
    }): Promise<TaskIntakeResult>;
    /**
     * Hash a message for deduplication using full content
     */
    private hashMessage;
    /**
     * Record a capture request to prevent re-triggering
     */
    private _recordCapture;
    /**
     * Invalidate any pending evaluations (call when paused/stopped)
     */
    invalidatePending(): void;
    /**
     * Check if stopped
     */
    isStopped(): boolean;
    /**
     * Internal evaluation logic
     */
    private _evaluate;
    /**
     * Simple heuristic when Jev is not available
     */
    private simpleHeuristic;
    /**
     * Dispatch a capture request to the agent
     * @param userMessage - The original user message to capture
     * @param customType - Optional custom type for the message (default: "task-capture")
     */
    requestCapture(userMessage: string, customType?: string): Promise<void>;
    /**
     * Reset state
     */
    reset(): void;
}
/**
 * Create a task intake controller
 */
export declare function createTaskIntake(config: TaskIntakeConfig): TaskIntakeController;
//# sourceMappingURL=task-intake.d.ts.map