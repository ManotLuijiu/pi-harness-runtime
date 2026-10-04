/**
 * Review Integration
 *
 * Uses pi-subagents review-loop for multi-round code review.
 */
import type { WriteReviewStatus } from "./types.js";
/**
 * Review round result
 */
export interface ReviewResult {
    verdict: "approved" | "changes_requested" | "blocked";
    iteration: number;
    message: string;
    changesNeeded?: string[];
    issues?: ReviewIssue[];
}
/**
 * Issue found during review
 */
export interface ReviewIssue {
    severity: "blocker" | "major" | "minor" | "suggestion";
    type: "correctness" | "security" | "performance" | "style" | "test" | "docs";
    location: string;
    description: string;
    suggestion?: string;
}
/**
 * Build review task for pi-subagents
 */
export declare function buildReviewTask(status: WriteReviewStatus, projectPath: string): string;
/**
 * Parse verdict from review output
 */
export declare function parseVerdict(output: string): {
    verdict: "approved" | "changes_requested" | "blocked";
    message: string;
    changes?: string[];
} | null;
/**
 * Review angles for parallel review
 */
export declare const REVIEW_ANGLES: {
    name: string;
    description: string;
}[];
/**
 * Build parallel review prompt
 */
export declare function buildParallelReviewPrompt(codeFiles: string[], projectPath: string): string;
/**
 * Format review summary for blackboard
 */
export declare function formatReviewSummary(result: ReviewResult): string;
//# sourceMappingURL=review.d.ts.map