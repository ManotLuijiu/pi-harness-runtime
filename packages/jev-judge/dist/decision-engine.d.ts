/**
 * Decision Engine - Threshold-based routing and action decisions
 *
 * Wraps Jev decisions with configurable thresholds for automated actions.
 */
import { JevJudge } from "./index.js";
import type { JevJudgeConfig } from "./types.js";
/**
 * Threshold configuration for automatic decisions
 */
export interface ThresholdConfig {
    /** Threshold for automatic approval (default: 0.9) */
    approval?: number;
    /** Threshold for requiring review (default: 0.5) */
    review?: number;
    /** Threshold for automatic blocking (default: 0.2) */
    block?: number;
    /** Custom thresholds per question ID */
    perQuestion?: Record<string, {
        approval?: number;
        review?: number;
        block?: number;
    }>;
}
/**
 * Action result from the decision engine
 */
export interface ActionResult {
    action: "proceed" | "review" | "block";
    shouldAct: boolean;
    probability: number;
    confidence: "high" | "medium" | "low";
    reason: string;
}
/**
 * Decision Engine - Makes automated decisions based on Jev probabilities
 */
export declare class DecisionEngine {
    private judge;
    private defaultThresholds;
    constructor(config: JevJudgeConfig, thresholds?: ThresholdConfig);
    /**
     * Decide action based on probability and thresholds
     */
    decide(probability: number, thresholds?: ThresholdConfig): ActionResult;
    /**
     * Decide with per-question thresholds
     */
    decideWithThresholds(probabilities: Record<string, number>, thresholds?: ThresholdConfig): Record<string, ActionResult>;
    /**
     * Route to appropriate handler based on decision
     */
    route<T>(decision: ActionResult, handlers: {
        onProceed?: () => T | Promise<T>;
        onReview?: () => T | Promise<T>;
        onBlock?: () => T | Promise<T>;
    }): Promise<T> | T;
    /**
     * Batch decision with voting
     */
    batchDecide(decisions: {
        id: string;
        probability: number;
    }[], threshold?: number): {
        passed: string[];
        failed: string[];
        threshold: number;
    };
    /**
     * Weighted voting for multiple judges
     */
    weightedVote(votes: {
        weight: number;
        probability: number;
    }[]): {
        weightedAverage: number;
        decision: ActionResult;
    };
    private getConfidence;
}
/**
 * Routing helpers for common use cases
 */
export declare class Router {
    /**
     * Route to todo or bd based on task description
     */
    static routeTaskTracker(taskDescription: string, judge: JevJudge): Promise<{
        tracker: "todo" | "bd";
        confidence: number;
    }>;
    /**
     * Route to appropriate severity level
     */
    static routeSeverity(issue: string, judge: JevJudge): Promise<{
        severity: "critical" | "high" | "medium" | "low";
        probability: number;
    }>;
}
//# sourceMappingURL=decision-engine.d.ts.map