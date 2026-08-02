/**
 * System Prompt Injection
 *
 * Adds write-review hints to the agent's system prompt.
 */

/**
 * Write-review hint for system prompt
 */
export const WRITE_REVIEW_HINT = `

## Write-Review Loop

When reading a prompt from {project}/wiki/*:

1. You are the **WRITER** agent (Minimax). Read the wiki prompt and write code.
2. After writing code, write "## WRITER_DONE" to signal completion.
3. Do NOT build or commit until you receive "APPROVED" verdict.
4. If you receive "CHANGES_REQUESTED", update the code accordingly.
5. Acknowledge each verdict in your response.

### Blackboard Path
{p}/.write-review/status.json

### Verdict Types
- **APPROVED**: Code is ready. You may build/commit.
- **CHANGES_REQUESTED**: Reviewer found issues. Update code.
- **BLOCKED**: Critical issues. Human intervention needed.
`;

/**
 * Helper agent hint (for worker agent)
 */
export const HELPER_HINT = `

## Helper Agent Task

The writer agent is busy or needs assistance. Your task:

1. Note any pending tasks to the Todos list using the todo tool.
2. Review the changes requested and prepare notes for the writer.
3. Do NOT write code directly - that's the writer's job.
4. Write a summary of pending tasks to the blackboard.
`;

/**
 * Review reminder hint
 */
export const REVIEW_REMINDER_HINT = `

## Review Reminder

Before committing or building, ALWAYS check the write-review status:

\`\`\`bash
cat {project}/.write-review/status.json
\`\`\`

Only build/commit if the status shows "approved" or "phase": "approved".
`;

/**
 * Format hint with project path
 */
export function formatWriteReviewHint(projectPath: string): string {
  return WRITE_REVIEW_HINT.replace("{project}", projectPath).replace("{p}", projectPath);
}

/**
 * Format review reminder with project path
 */
export function formatReviewReminder(projectPath: string): string {
  return REVIEW_REMINDER_HINT.replace("{project}", projectPath);
}

/**
 * Get all hints to inject
 */
export function getWriteReviewHints(projectPath: string): {
  writeHint: string;
  reminderHint: string;
} {
  return {
    writeHint: formatWriteReviewHint(projectPath),
    reminderHint: formatReviewReminder(projectPath),
  };
}

/**
 * Register write-review extension with pi
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBlackboard } from "./blackboard.js";

export function injectWriterInstructions(
  pi: ExtensionAPI,
  config?: { debug?: boolean }
): void {
  let currentProject: string | null = null;
  let blackboard: ReturnType<typeof createBlackboard> | null = null;
  let hintsInjected = false;

  // System prompt injection
  pi.on("before_agent_start", async (event) => {
    const cwd = process.cwd?.() ?? "/";
    if (cwd !== currentProject) {
      currentProject = cwd;
      blackboard = createBlackboard(cwd);
      hintsInjected = false;
    }

    if (!hintsInjected && blackboard) {
      const status = blackboard.load();
      if (status && status.phase !== "idle") {
        event.systemPrompt += formatWriteReviewHint(cwd);
        if (status.phase !== "approved") {
          event.systemPrompt += formatReviewReminder(cwd);
        }
        hintsInjected = true;
        if (config?.debug) {
          console.log(`[write-review] Hints injected for ${cwd}, phase: ${status.phase}`);
        }
      }
    }
  });

  // Build gate
  pi.on("tool_execution_end", async (event) => {
    const toolName = (event as { tool?: { name?: string } }).tool?.name ?? "";
    if (toolName !== "bash") return;

    const result = event as { result?: { content?: string } };
    const content = result.result?.content ?? "";

    // Check for build commands
    const buildCommands = [
      "bench build", "npm run build", "yarn build",
      "pnpm build", "bun run build", "make build",
      "gradle build", "dotnet build", "cargo build",
    ];
    const isBuild = buildCommands.some(cmd => content.includes(cmd));

    if (isBuild && blackboard) {
      const status = blackboard.load();
      if (status && status.phase !== "approved") {
        result.result!.content = content + "\n\n" +
          "⚠️ BUILD BLOCKED - Review not approved yet.\n" +
          `Current phase: ${status.phase}\n` +
          "Wait for APPROVED verdict before building.";
      }
    }
  });

  if (config?.debug) {
    console.log("[write-review] Extension registered");
  }
}
