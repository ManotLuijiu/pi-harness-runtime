/**
 * Code Review Engine - Text Reporter
 *
 * Generate text format reports.
 */
export class TextReporter {
    /**
     * Generate text report
     */
    generate(result, options) {
        const lines = [];
        // Header
        lines.push("=".repeat(60));
        lines.push("CODE REVIEW REPORT");
        lines.push("=".repeat(60));
        lines.push(`Review ID: ${result.id}`);
        lines.push(`Timestamp: ${result.timestamp}`);
        lines.push(`Duration: ${result.durationMs}ms`);
        lines.push("");
        // Summary
        if (options.includeSummary !== false) {
            lines.push("-".repeat(60));
            lines.push("SUMMARY");
            lines.push("-".repeat(60));
            lines.push(`Files Reviewed: ${result.stats.filesReviewed}`);
            lines.push(`Lines Reviewed: ${result.stats.linesReviewed}`);
            lines.push(`Total Issues: ${result.summary.total}`);
            lines.push(`  - Errors: ${result.summary.errors}`);
            lines.push(`  - Warnings: ${result.summary.warnings}`);
            lines.push(`  - Info: ${result.summary.info}`);
            lines.push(`  - Hints: ${result.summary.hints}`);
            lines.push("");
        }
        // Issues
        if (result.issues.length > 0) {
            lines.push("-".repeat(60));
            lines.push("ISSUES");
            lines.push("-".repeat(60));
            // Group issues
            const groupedIssues = options.groupByFile
                ? this.groupByFile(result.issues)
                : options.groupBySeverity
                    ? this.groupBySeverity(result.issues)
                    : [{ header: "", issues: result.issues }];
            for (const group of groupedIssues) {
                if (group.header) {
                    lines.push("");
                    lines.push(`${group.header}:`);
                    lines.push("~".repeat(40));
                }
                for (const issue of group.issues) {
                    lines.push("");
                    lines.push(this.formatIssue(issue, options));
                }
            }
        }
        lines.push("");
        lines.push("=".repeat(60));
        lines.push("END OF REPORT");
        lines.push("=".repeat(60));
        return lines.join("\n");
    }
    /**
     * Format a single issue
     */
    formatIssue(issue, options) {
        const lines = [];
        const severityIcon = this.getSeverityIcon(issue.severity);
        lines.push(`${severityIcon} [${issue.severity.toUpperCase()}] ${issue.title}`);
        lines.push(`    Category: ${issue.category}`);
        lines.push(`    File: ${issue.file}${issue.line ? `:${issue.line}` : ""}`);
        if (issue.rule) {
            lines.push(`    Rule: ${issue.rule}`);
        }
        lines.push(`    ${issue.message}`);
        if (issue.suggestion && options.includeSuggestions !== false) {
            lines.push(`    Suggestion: ${issue.suggestion}`);
        }
        if (issue.code && options.includeCode !== false) {
            lines.push(`    Code: ${issue.code}`);
        }
        return lines.join("\n");
    }
    /**
     * Get severity icon
     */
    getSeverityIcon(severity) {
        switch (severity) {
            case "error":
                return "✗";
            case "warning":
                return "⚠";
            case "info":
                return "ℹ";
            case "hint":
                return "💡";
            default:
                return "•";
        }
    }
    /**
     * Group issues by file
     */
    groupByFile(issues) {
        const groups = new Map();
        for (const issue of issues) {
            const existing = groups.get(issue.file);
            if (existing) {
                existing.push(issue);
            }
            else {
                groups.set(issue.file, [issue]);
            }
        }
        return Array.from(groups.entries()).map(([file, fileIssues]) => ({
            header: file,
            issues: fileIssues,
        }));
    }
    /**
     * Group issues by severity
     */
    groupBySeverity(issues) {
        const groups = new Map();
        const order = ["error", "warning", "info", "hint"];
        for (const issue of issues) {
            const existing = groups.get(issue.severity);
            if (existing) {
                existing.push(issue);
            }
            else {
                groups.set(issue.severity, [issue]);
            }
        }
        return order
            .filter((s) => groups.has(s))
            .map((severity) => ({
            header: severity.toUpperCase(),
            issues: groups.get(severity),
        }));
    }
}
//# sourceMappingURL=text.js.map