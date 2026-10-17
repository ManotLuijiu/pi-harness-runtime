/**
 * Durable Review Extension
 *
 * Small Pi command adapter for /harness-review, /harness-review-status, /harness-review-cancel.
 */

import { validateReviewRequest } from "./types.js";
import {
  submitReviewRequest,
  getReviewStatus,
  cancelReview,
  checkWorkerReady,
} from "./client.js";

/**
 * Feature flag
 */
const DURABLE_REVIEW_ENABLED = process.env.HARNESS_DURABLE_REVIEW === "1";

/**
 * Help text when feature is disabled
 */
const DISABLED_HELP = `
Durable Review is not enabled. To enable:

1. Set environment variable: HARNESS_DURABLE_REVIEW=1
2. Restart Pi
3. Start a worker: node packages/durable-review/dist/worker.js

This feature provides SQLite-backed review with crash recovery.
`.trim();

/**
 * Handle /harness-review command
 */
export async function handleHarnessReview(args: {
  request: string;
  workspacePath?: string;
}): Promise<string> {
  if (!DURABLE_REVIEW_ENABLED) {
    return DISABLED_HELP;
  }

  try {
    // Parse request
    let request;
    try {
      request = JSON.parse(args.request);
    } catch {
      return "Error: Request must be valid JSON. Usage: /harness-review <json-request>";
    }

    // Validate
    const validation = validateReviewRequest(request);
    if (!validation.valid) {
      return `Error: ${validation.error}`;
    }

    // Check worker readiness
    const ready = await checkWorkerReady(validation.request!.input.workspacePath);
    if (!ready.ready) {
      return `Error: Worker not ready - ${ready.error || "unknown error"}`;
    }

    // Submit request
    const result = await submitReviewRequest(validation.request!);
    return `Review started: ${result.jobId}\nStatus: ${result.status.status}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Handle /harness-review-status command
 */
export async function handleHarnessReviewStatus(args: {
  jobId: string;
  workspacePath?: string;
}): Promise<string> {
  if (!DURABLE_REVIEW_ENABLED) {
    return DISABLED_HELP;
  }

  try {
    const workspacePath = args.workspacePath || process.cwd();
    const status = await getReviewStatus(args.jobId, workspacePath);

    if (!status) {
      return `Job not found: ${args.jobId}`;
    }

    const lines = [
      `Job: ${status.jobId}`,
      `Status: ${status.status}`,
    ];

    if (status.verdict) {
      lines.push(`Verdict: ${status.verdict}`);
    }
    if (status.summary) {
      lines.push(`Summary: ${status.summary}`);
    }
    if (status.error) {
      lines.push(`Error: ${status.error}`);
    }
    if (status.findings && status.findings.length > 0) {
      lines.push(`Findings: ${status.findings.length}`);
    }

    lines.push(`Created: ${status.createdAt}`);
    lines.push(`Updated: ${status.updatedAt}`);

    return lines.join("\n");
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Handle /harness-review-cancel command
 */
export async function handleHarnessReviewCancel(args: {
  jobId: string;
  workspacePath?: string;
}): Promise<string> {
  if (!DURABLE_REVIEW_ENABLED) {
    return DISABLED_HELP;
  }

  try {
    const workspacePath = args.workspacePath || process.cwd();
    const cancelled = await cancelReview(args.jobId, workspacePath);

    if (cancelled) {
      return `Job cancelled: ${args.jobId}`;
    } else {
      return `Failed to cancel job: ${args.jobId}. It may not exist or already be complete.`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Check for command collisions before registration
 */
export function checkCommandCollisions(commands: string[]): string[] {
  const reserved = ["/harness-review", "/harness-review-status", "/harness-review-cancel"];
  return reserved.filter((cmd) => commands.includes(cmd));
}
