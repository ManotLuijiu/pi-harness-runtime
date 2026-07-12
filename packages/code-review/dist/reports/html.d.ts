/**
 * Code Review Engine - HTML Reporter
 *
 * Generate HTML format reports.
 */
import type { ReportOptions, ReviewResult } from "../types.js";
export declare class HtmlReporter {
    /**
     * Generate HTML report
     */
    generate(result: ReviewResult, options: ReportOptions): string;
    /**
     * Render a single issue
     */
    private renderIssue;
    /**
     * Escape HTML
     */
    private escapeHtml;
}
//# sourceMappingURL=html.d.ts.map