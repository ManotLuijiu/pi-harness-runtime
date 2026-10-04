/**
 * System Prompt Injection
 *
 * Adds write-review hints to the agent's system prompt.
 */
/**
 * Write-review hint for system prompt
 */
export declare const WRITE_REVIEW_HINT = "\n\n## Write-Review Loop\n\nWhen reading a prompt from {project}/wiki/*:\n\n1. You are the **WRITER** agent (Minimax). Read the wiki prompt and write code.\n2. After writing code, write \"## WRITER_DONE\" to signal completion.\n3. Do NOT build or commit until you receive \"APPROVED\" verdict.\n4. If you receive \"CHANGES_REQUESTED\", update the code accordingly.\n5. Acknowledge each verdict in your response.\n\n### Blackboard Path\n{p}/.write-review/status.json\n\n### Verdict Types\n- **APPROVED**: Code is ready. You may build/commit.\n- **CHANGES_REQUESTED**: Reviewer found issues. Update code.\n- **BLOCKED**: Critical issues. Human intervention needed.\n";
/**
 * Helper agent hint (for worker agent)
 */
export declare const HELPER_HINT = "\n\n## Helper Agent Task\n\nThe writer agent is busy or needs assistance. Your task:\n\n1. Note any pending tasks to the Todos list using the todo tool.\n2. Review the changes requested and prepare notes for the writer.\n3. Do NOT write code directly - that's the writer's job.\n4. Write a summary of pending tasks to the blackboard.\n";
/**
 * Review reminder hint
 */
export declare const REVIEW_REMINDER_HINT = "\n\n## Review Reminder\n\nBefore committing or building, ALWAYS check the write-review status:\n\n```bash\ncat {project}/.write-review/status.json\n```\n\nOnly build/commit if the status shows \"approved\" or \"phase\": \"approved\".\n";
/**
 * Format hint with project path
 */
export declare function formatWriteReviewHint(projectPath: string): string;
/**
 * Format review reminder with project path
 */
export declare function formatReviewReminder(projectPath: string): string;
/**
 * Get all hints to inject
 */
export declare function getWriteReviewHints(projectPath: string): {
    writeHint: string;
    reminderHint: string;
};
/**
 * Register write-review extension with pi
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export declare function injectWriterInstructions(pi: ExtensionAPI, config?: {
    debug?: boolean;
}): void;
//# sourceMappingURL=injection.d.ts.map