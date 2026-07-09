/**
 * Code Review Engine - Text Reporter
 *
 * Generate text format reports.
 */
import type { ReportOptions, ReviewResult } from "../types.js";
export declare class TextReporter {
    /**
     * Generate text report
     */
    generate(result: ReviewResult, options: ReportOptions): string;
    /**
     * Format a single issue
     */
    private formatIssue;
    /**
     * Get severity icon
     */
    private getSeverityIcon;
    /**
     * Group issues by file
     */
    private groupByFile;
    /**
     * Group issues by severity
     */
    private groupBySeverity;
}
//# sourceMappingURL=text.d.ts.map