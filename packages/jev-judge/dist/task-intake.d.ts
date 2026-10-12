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
     * Simple heuristic when Jev is not available
     */
    private simpleHeuristic;
    /**
     * Dispatch a capture request to the agent
     */
    requestCapture(userMessage: string, existingTodos?: string[]): Promise<void>;
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