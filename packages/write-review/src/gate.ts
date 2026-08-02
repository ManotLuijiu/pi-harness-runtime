/**
 * No-Build Gate
 *
 * Blocks build commands until review is approved.
 */

import type { WriteReviewBlackboard } from "./blackboard.js";
import type { WriteReviewStatus } from "./types.js";

/**
 * Commands that trigger build gate
 */
const BUILD_COMMANDS = [
  "bench build",
  "npm run build",
  "yarn build",
  "pnpm build",
  "bun run build",
  "npm run dev",
  "yarn dev",
  "pnpm dev",
  "./build",
  "make build",
  "gradle build",
  "mvn package",
  "dotnet build",
  "cargo build",
  "go build",
  "python manage.py migrate",
  "bench migrate",
  "bench --site",
];

/**
 * Check if a command is a build command
 */
export function isBuildCommand(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return BUILD_COMMANDS.some((cmd) => lower.includes(cmd.toLowerCase()));
}

/**
 * Gate result
 */
export interface GateResult {
  allowed: boolean;
  reason?: string;
  currentPhase?: string;
  message?: string;
}

/**
 * Check if build is allowed
 */
export function checkBuildGate(
  command: string,
  blackboard: WriteReviewBlackboard
): GateResult {
  if (!isBuildCommand(command)) {
    return { allowed: true };
  }

  const status = blackboard.load();
  if (!status) {
    // No review session - allow build
    return { allowed: true };
  }

  if (status.phase === "approved") {
    return {
      allowed: true,
      currentPhase: status.phase,
      message: "Build allowed - review approved.",
    };
  }

  return {
    allowed: false,
    reason: "REVIEW_NOT_APPROVED",
    currentPhase: status.phase,
    message: `Build blocked. Current review phase: ${status.phase}. Wait for "APPROVED" verdict.`,
  };
}

/**
 * Format gate rejection message
 */
export function formatGateRejection(result: GateResult): string {
  if (result.allowed) {
    return "";
  }

  const lines = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "⚠️  BUILD BLOCKED",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `Current Phase: ${result.currentPhase}`,
    "",
    "The code is under review. Build is only allowed after APPROVED verdict.",
    "",
    "To check status:",
    `  cat {project}/.write-review/status.json`,
    "",
    "To wait for approval, do nothing. The reviewer will post the verdict.",
    "",
  ];

  if (result.currentPhase === "changes_requested") {
    lines.push("Reviewer requested changes. Writer agent should update the code.");
  } else if (result.currentPhase === "reviewing") {
    lines.push("Review is in progress. Please wait...");
  } else if (result.currentPhase === "pending_review") {
    lines.push("Review not started yet. Waiting for reviewer...");
  }

  return lines.join("\n");
}

/**
 * Get phase emoji
 */
export function getPhaseEmoji(phase: string): string {
  const emojis: Record<string, string> = {
    idle: "💤",
    writing: "✍️",
    pending_review: "⏳",
    reviewing: "🔍",
    approved: "✅",
    blocked: "🚫",
    changes_requested: "🔄",
  };
  return emojis[phase] ?? "❓";
}

/**
 * Format status for display
 */
export function formatStatusDisplay(status: WriteReviewStatus): string {
  const emoji = getPhaseEmoji(status.phase);
  const lines = [
    `${emoji} Write-Review Status`,
    "",
    `Phase: ${status.phase}`,
    `Iteration: ${status.iteration}`,
  ];

  if (status.verdict) {
    lines.push(`Verdict: ${status.verdict}`);
  }

  if (status.verdictMessage) {
    lines.push("");
    lines.push("Message:");
    lines.push(status.verdictMessage);
  }

  if (status.codeFiles && status.codeFiles.length > 0) {
    lines.push("");
    lines.push("Code Files:");
    for (const file of status.codeFiles) {
      lines.push(`  - ${file}`);
    }
  }

  return lines.join("\n");
}
