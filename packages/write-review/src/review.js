/**
 * Review Integration
 *
 * Uses pi-subagents review-loop for multi-round code review.
 */
/**
 * Build review task for pi-subagents
 */
export function buildReviewTask(status, projectPath) {
    const codeFiles = status.codeFiles ?? [];
    const iteration = status.iteration;
    const task = `## Review Task - Iteration ${iteration}

Review the code written in this iteration.

### Code Files to Review:
${codeFiles.map((f) => `- ${f}`).join("\n") || "No files recorded yet."}

### Project Path: ${projectPath}

### Review Instructions:
1. Read the code files listed above.
2. Run the review-loop workflow using pi-subagents.
3. Focus on: correctness, security, performance, tests, and code style.
4. Return a verdict: APPROVED, CHANGES_REQUESTED, or BLOCKED.

### Verdict Format:
\`\`\`
## Verdict: [APPROVED|CHANGES_REQUESTED|BLOCKED]
[Your detailed review message]
\`\`\`

For CHANGES_REQUESTED, list specific changes needed:
\`\`\`
## Changes Needed:
1. [Issue description] - [File:Line]
2. [Issue description] - [File:Line]
\`\`\`
`;
    return task;
}
/**
 * Parse verdict from review output
 */
export function parseVerdict(output) {
    const lines = output.split("\n");
    let verdict = null;
    let message = "";
    const changes = [];
    let inChanges = false;
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.includes("## verdict:")) {
            if (lower.includes("approved")) {
                verdict = "approved";
            }
            else if (lower.includes("changes_requested") ||
                lower.includes("changes requested")) {
                verdict = "changes_requested";
            }
            else if (lower.includes("blocked")) {
                verdict = "blocked";
            }
            continue;
        }
        if (lower.includes("## changes needed:") || lower.includes("changes:")) {
            inChanges = true;
            continue;
        }
        if (inChanges && line.trim().match(/^\d+\./)) {
            changes.push(line.trim());
            continue;
        }
        if (verdict && line.trim()) {
            message += line + "\n";
        }
    }
    if (!verdict)
        return null;
    return {
        verdict,
        message: message.trim(),
        changes: changes.length > 0 ? changes : undefined,
    };
}
/**
 * Review angles for parallel review
 */
export const REVIEW_ANGLES = [
    {
        name: "correctness",
        description: "Verify implementation matches requirements and handles edge cases",
    },
    {
        name: "tests",
        description: "Check test coverage and validity",
    },
    {
        name: "complexity",
        description: "Look for unnecessary complexity and opportunities to simplify",
    },
];
/**
 * Build parallel review prompt
 */
export function buildParallelReviewPrompt(codeFiles, projectPath) {
    return `Run parallel reviewers on this code:

1. **correctness** - Verify implementation matches requirements and handles edge cases
2. **tests** - Check test coverage and validity
3. **complexity** - Look for unnecessary complexity

Files: ${codeFiles.join(", ")}
Project: ${projectPath}

Use pi-subagents to spawn 3 parallel reviewers. Wait for all results, then synthesize into a final verdict.`;
}
/**
 * Format review summary for blackboard
 */
export function formatReviewSummary(result) {
    const lines = [
        `## Review Result - Iteration ${result.iteration}`,
        "",
        `**Verdict:** ${result.verdict.toUpperCase()}`,
        "",
    ];
    if (result.message) {
        lines.push("### Message");
        lines.push(result.message);
        lines.push("");
    }
    if (result.changesNeeded && result.changesNeeded.length > 0) {
        lines.push("### Changes Needed");
        for (const change of result.changesNeeded) {
            lines.push(`- ${change}`);
        }
        lines.push("");
    }
    if (result.issues && result.issues.length > 0) {
        lines.push("### Issues Found");
        for (const issue of result.issues) {
            lines.push(`- [${issue.severity}] ${issue.type}: ${issue.description}`);
            if (issue.location) {
                lines.push(`  Location: ${issue.location}`);
            }
            if (issue.suggestion) {
                lines.push(`  Suggestion: ${issue.suggestion}`);
            }
        }
    }
    return lines.join("\n");
}
