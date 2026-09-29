/**
 * Continue Prompt Generator — RFC-0029
 *
 * Generates context-aware continue prompts after compaction.
 * Based on the reference implementation's buildContinuePrompt() pattern.
 */
// --- Continue Prompt Generator -----------------------------------------------
export class ContinuePromptGenerator {
    /**
     * Generate a comprehensive continue prompt for post-compact resume
     */
    generate(context) {
        const parts = [
            "# Continue Previous Task",
            "",
            "## Task",
            context.requirement,
            "",
        ];
        if (context.whatWasCompleted.length > 0) {
            parts.push("## What Was Completed");
            for (const item of context.whatWasCompleted) {
                parts.push(`- ${item}`);
            }
            parts.push("");
        }
        if (context.partialFiles.length > 0) {
            parts.push("## Partial Files Created");
            parts.push("Review these files — they may contain incomplete work:");
            for (const file of context.partialFiles) {
                parts.push(`- ${file}`);
            }
            parts.push("");
        }
        if (context.decisions.length > 0) {
            parts.push("## Key Decisions");
            for (const decision of context.decisions) {
                parts.push(`- ${decision}`);
            }
            parts.push("");
        }
        if (context.whatNeedsToBeDone.length > 0) {
            parts.push("## What Needs To Be Done");
            for (const item of context.whatNeedsToBeDone) {
                parts.push(`- ${item}`);
            }
            parts.push("");
        }
        parts.push("## Instructions", "", "1. Review any partial files created above", "2. Continue from where the previous session ended", "3. Complete the remaining work listed in 'What Needs To Be Done'", "4. Ensure all tests pass before marking complete", "", "**Do not repeat work that was already completed.**", "");
        if (context.nextStep) {
            parts.push("## Suggested Next Step");
            parts.push(context.nextStep);
        }
        if (context.workingDir) {
            parts.push("", `Working directory: \`${context.workingDir}\``);
        }
        return parts.join("\n");
    }
    /**
     * Generate a minimal continue message for quick resume
     */
    generateMinimal(context) {
        const recent = context.recentMessages
            .slice(-5)
            .map((m) => `[${m.role}]\n${this.truncateContent(m.content, 500)}`)
            .join("\n\n");
        return [
            "Continue from where you left off.",
            "",
            "## Summary of Earlier Work",
            context.summary,
            "",
            "## Recent Context",
            recent,
            "",
            "**Do not repeat work already done.** Focus on completing the remaining work.",
        ].join("\n");
    }
    /**
     * Generate a compact boundary message for message history
     */
    generateBoundary(options) {
        return [
            "## Earlier Conversation Summarized",
            "",
            `[Compacted due to: ${options.reason}]`,
            `[${options.messagesCompacted} messages summarized]`,
            "",
            options.summary,
            "",
            "## Resume Point",
            "Continue from the messages below.",
        ].join("\n");
    }
    /**
     * Extract continue context from compact result
     */
    static fromCompactResult(result, task) {
        return {
            taskId: task.id,
            requirement: task.requirement,
            whatWasCompleted: result.summary
                ? ContinuePromptGenerator.extractCompletedWork(result.summary)
                : [],
            whatNeedsToBeDone: ["Continue from where the conversation was compacted"],
            partialFiles: [],
            decisions: result.summary
                ? ContinuePromptGenerator.extractDecisions(result.summary)
                : [],
        };
    }
    /**
     * Extract completed work items from summary text
     */
    static extractCompletedWork(summary) {
        const completed = [];
        // Look for patterns indicating completed work
        const patterns = [
            /completed?:?\s*([^\n.]+)/gi,
            /created?:?\s*([^\n.]+)/gi,
            /implemented?:?\s*([^\n.]+)/gi,
            /fixed?:?\s*([^\n.]+)/gi,
            /passed?:?\s*([^\n.]+)/gi,
        ];
        for (const pattern of patterns) {
            for (const match of summary.matchAll(pattern)) {
                if (match[1]) {
                    completed.push(match[1].trim());
                }
            }
        }
        return completed.slice(0, 5);
    }
    /**
     * Extract decisions from summary text
     */
    static extractDecisions(summary) {
        const decisions = [];
        const patterns = [
            /decided?:?\s*([^\n.]+)/gi,
            /chose?:?\s*([^\n.]+)/gi,
            /approach?:?\s*([^\n.]+)/gi,
            /using?:?\s*([^\n.]+)/gi,
        ];
        for (const pattern of patterns) {
            for (const match of summary.matchAll(pattern)) {
                if (match[1]) {
                    decisions.push(match[1].trim());
                }
            }
        }
        return decisions.slice(0, 5);
    }
    /**
     * Truncate content to max length
     */
    truncateContent(content, maxLength) {
        if (content.length <= maxLength)
            return content;
        return content.substring(0, maxLength) + "... [truncated]";
    }
}
// --- Singleton Instance ------------------------------------------------------
export const continuePromptGenerator = new ContinuePromptGenerator();
