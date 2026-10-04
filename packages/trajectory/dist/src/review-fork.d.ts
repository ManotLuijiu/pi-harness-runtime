/**
 * Background Review Fork
 *
 * Background review that analyzes trajectories and suggests:
 * - Memory entries to persist
 * - Skills to create/update
 * - User preferences to learn
 *
 * Based on Hermes Agent's closed learning loop.
 */
import type { Trajectory } from "./types.js";
/**
 * Background review configuration
 */
export interface BackgroundReviewConfig {
    /** Enable background review */
    enabled: boolean;
    /** Cycles between reviews (1 = every cycle) */
    nudgeInterval: number;
    /** Reasoning effort for review */
    reasoningEffort: "low" | "medium" | "high";
    /** Route to cheaper model for review */
    routeToCheaperModel: boolean;
    /** Cheaper model to use */
    cheaperModel?: string;
    /** Require approval before writes */
    writeApproval: boolean;
    /** Defer review when GPU busy */
    deferWhenGpuBusy: boolean;
    /** Max age in seconds before running queued review */
    deferMaxAgeSeconds: number;
}
/**
 * Default background review configuration
 */
export declare const DEFAULT_REVIEW_CONFIG: BackgroundReviewConfig;
/**
 * Review suggestion types
 */
export type SuggestionType = "memory" | "skill_create" | "skill_patch" | "user_profile" | "pattern";
/**
 * Review suggestion
 */
export interface ReviewSuggestion {
    id: string;
    type: SuggestionType;
    priority: "low" | "medium" | "high";
    content: string;
    reason: string;
    trajectoryId?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Review result
 */
export interface ReviewResult {
    trajectoryId: string;
    suggestions: ReviewSuggestion[];
    patterns: string[];
    corrections: string[];
    timestamp: number;
}
/**
 * Review event types
 */
export type ReviewEvent = {
    type: "review.started";
    trajectoryId: string;
} | {
    type: "review.completed";
    result: ReviewResult;
} | {
    type: "review.error";
    error: string;
    trajectoryId: string;
} | {
    type: "suggestion.created";
    suggestion: ReviewSuggestion;
} | {
    type: "suggestion.approved";
    suggestion: ReviewSuggestion;
} | {
    type: "suggestion.rejected";
    suggestion: ReviewSuggestion;
};
/**
 * Review event handler
 */
export type ReviewEventHandler = (event: ReviewEvent) => void;
/**
 * Background Review Fork
 */
export declare class BackgroundReviewFork {
    private config;
    private cycleCount;
    private queuedReview;
    private handlers;
    private pendingSuggestions;
    constructor(config?: Partial<BackgroundReviewConfig>);
    /**
     * Update configuration
     */
    updateConfig(config: Partial<BackgroundReviewConfig>): void;
    /**
     * Register event handler
     */
    on(handler: ReviewEventHandler): () => void;
    /**
     * Emit event to all handlers
     */
    private emit;
    /**
     * Process cycle end - check if review should run
     */
    onCycleEnd(trajectory: Trajectory): void;
    /**
     * Run review on trajectory
     */
    runReview(trajectory: Trajectory): Promise<ReviewResult>;
    /**
     * Analyze trajectory and generate suggestions
     */
    private analyzeTrajectory;
    /**
     * Generate skill content from trajectory
     */
    private generateSkillFromTrajectory;
    /**
     * Extract task type from request
     */
    private extractTaskType;
    /**
     * Extract user preferences from summary
     */
    private extractUserPreferences;
    /**
     * Get pending suggestions
     */
    getPendingSuggestions(): ReviewSuggestion[];
    /**
     * Approve suggestion
     */
    approveSuggestion(suggestionId: string): ReviewSuggestion | null;
    /**
     * Reject suggestion
     */
    rejectSuggestion(suggestionId: string): ReviewSuggestion | null;
    /**
     * Clear all pending suggestions
     */
    clearSuggestions(): void;
    /**
     * Get review stats
     */
    getStats(): {
        cycleCount: number;
        pendingCount: number;
        enabled: boolean;
        nudgeInterval: number;
    };
}
export declare function getGlobalReviewFork(): BackgroundReviewFork;
export declare function createReviewFork(config?: Partial<BackgroundReviewConfig>): BackgroundReviewFork;
//# sourceMappingURL=review-fork.d.ts.map