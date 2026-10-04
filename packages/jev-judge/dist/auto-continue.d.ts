/**
 * Auto-Continue Judge - Agent decision making when user is unavailable
 *
 * Uses Jev to decide whether an agent should continue autonomously
 * when waiting for user input that may not come.
 *
 * Scenario: Agent completes 2/5 tasks, asks "Continue?" User asleep.
 * Jev decides: proceed, wait, or proceed with caution.
 */
import type { JevJudgeConfig } from "./types.js";
/**
 * Task tracking state
 */
export interface TaskState {
    completedTasks: string[];
    remainingTasks: string[];
    totalTasks: number;
    waitTimeMinutes: number;
    userResponded: boolean;
    lastUserActivity?: Date;
    sessionStartTime: Date;
}
/**
 * Auto-continue decision
 */
export interface AutoContinueDecision {
    action: "proceed" | "wait" | "proceed_with_caution";
    probability: number;
    riskLevel: "minimal" | "low" | "medium" | "high" | "critical";
    reasoning: string;
    urgency: "critical" | "high" | "normal" | "low";
    estimatedImpact: "minimal" | "moderate" | "significant" | "major";
    confidence: "high" | "medium" | "low";
    waitRecommendation?: number;
}
/**
 * Auto-Continue Judge configuration
 */
export interface AutoContinueConfig extends JevJudgeConfig {
    /** Minimum probability to auto-proceed (default: 0.7) */
    proceedThreshold?: number;
    /** Minimum probability to proceed with caution (default: 0.5) */
    cautionThreshold?: number;
    /** Maximum wait time before force decision (default: 30 minutes) */
    maxWaitMinutes?: number;
    /** Default action if Jev fails (default: "wait") */
    fallbackAction?: "proceed" | "wait" | "proceed_with_caution";
}
/**
 * Auto-Continue Judge
 *
 * Judges whether an agent should continue autonomously when user is unavailable.
 * Integrates with pi-coding-agent hooks for automatic decision making.
 */
export declare class AutoContinueJudge {
    private jev;
    private config;
    constructor(config: AutoContinueConfig);
    /**
     * Judge whether to continue or wait
     */
    decide(taskState: TaskState): Promise<AutoContinueDecision>;
    /**
     * Quick decision - simple yes/no to proceed
     */
    shouldContinue(taskState: TaskState): Promise<{
        shouldContinue: boolean;
        probability: number;
        confidence: string;
    }>;
    /**
     * Build state for Jev
     */
    private buildState;
    /**
     * Build decision from Jev result
     */
    private buildDecision;
    /**
     * Convert score to risk level
     */
    private scoreToRiskLevel;
    /**
     * Fallback decision when Jev fails
     */
    private fallbackDecision;
}
/**
 * Helper: Create task state from todo list
 */
export declare function createTaskState(completedTasks: string[], remainingTasks: string[], lastUserActivity?: Date, sessionStartTime?: Date): TaskState;
//# sourceMappingURL=auto-continue.d.ts.map