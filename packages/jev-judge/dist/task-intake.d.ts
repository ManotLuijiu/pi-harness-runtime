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
    /**
     * The name of the tool that records the work.
     *
     * The harness knows which tool records the work of a request: the
     * plain todo tool, or the tool of a handoff that writes the
     * identifiers of the handoff into the todo. The name is asked for
     * when the instruction is written, so a request that belongs to a
     * handoff is not recorded with a tool that knows nothing of it.
     *
     * The message that is captured is given to the asker: the tool of a
     * handoff is named for the request that is captured, not for every
     * handoff of the session. A request that works on something else is
     * recorded with the plain tool, and its todo names no issue.
     */
    todoToolName?: (userMessage: string) => string;
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
     * Record that a capture was requested, to prevent re-triggering.
     *
     * The record is the state of the attempt. It is not the state of the
     * work: an item of the task list is what says that the work was
     * recorded, and only a read of the list says that.
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
     * Resume intake - clear stopped flag to re-enable processing
     */
    resumeIntake(): void;
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
     * @param _customType - Optional custom type for the message (default: "task-capture") - unused, kept for API compatibility
     */
    requestCapture(userMessage: string, _customType?: string): Promise<void>;
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