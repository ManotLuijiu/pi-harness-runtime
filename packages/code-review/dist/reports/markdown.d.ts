/**
 * Code Review Engine - Markdown Reporter
 *
 * Generate Markdown format reports.
 */
import type { ReportOptions, ReviewResult } from "../types.js";
export declare class MarkdownReporter {
    /**
     * Generate Markdown report
     */
    generate(result: ReviewResult, options: ReportOptions): string;
    /**
     * Format a single issue
     */
    private formatIssue;
    /**
     * Get severity emoji
     */
    private getSeverityEmoji;
    /**
     * Group issues by file
     */
    private groupByFile;
    /**
     * Group issues by severity
     */
    private groupBySeverity;
}
//# sourceMappingURL=markdown.d.ts.map