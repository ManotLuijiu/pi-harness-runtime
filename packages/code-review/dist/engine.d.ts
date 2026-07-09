/**
 * Code Review Engine - Engine
 *
 * Main code review engine with rule matching and multi-pass analysis.
 */
import type { CodeIssue, ReportOptions, ReviewFile, ReviewRequest, ReviewResult, ReviewRule, RuleSet } from "./types.js";
export declare class CodeReviewEngine {
    private rules;
    private ruleSets;
    private customMatchers;
    constructor();
    /**
     * Add a rule
     */
    addRule(rule: ReviewRule): void;
    /**
     * Add multiple rules
     */
    addRules(rules: ReviewRule[]): void;
    /**
     * Add a rule set
     */
    addRuleSet(set: RuleSet): void;
    /**
     * Register custom matcher
     */
    registerCustomMatcher(name: string, matcher: (file: ReviewFile) => CodeIssue[]): void;
    /**
     * Get enabled rules
     */
    getRules(): ReviewRule[];
    /**
     * Review files
     */
    review(request: ReviewRequest): Promise<ReviewResult>;
    /**
     * Apply rules to a file
     */
    private applyRules;
    /**
     * Get line and column info for a position
     */
    private getLineInfo;
    /**
     * Create an issue from a rule match
     */
    private createIssue;
    /**
     * Generate issue summary
     */
    private generateSummary;
    /**
     * Generate review statistics
     */
    private generateStats;
    /**
     * Generate unique ID
     */
    private generateId;
    /**
     * Generate report
     */
    generateReport(result: ReviewResult, options: ReportOptions): string;
}
/**
 * Create a code review engine
 */
export declare function createCodeReviewEngine(): CodeReviewEngine;
//# sourceMappingURL=engine.d.ts.map