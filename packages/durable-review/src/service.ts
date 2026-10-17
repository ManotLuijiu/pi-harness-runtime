/**
 * Durable Review Service
 *
 * Harness lifecycle, admission, status, cancellation and recovery.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Harness } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ReviewRequest, ReviewJob, ReviewStatusResponse } from "./types.js";
import type { ReviewJobRecord } from "./documents.js";
import { ReviewJobDoc, getJobFromDoc, updateJobInDoc } from "./documents.js";

/**
 * Workspace storage path
 */
function getDurableDir(): string {
  return join(homedir(), ".pi-harness-runtime", "durable");
}

/**
 * Get workspace-specific directory
 */
export function getWorkspaceDir(workspaceKey: string): string {
  const dir = join(getDurableDir(), workspaceKey);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get SQLite database path for workspace
 */
export function getDatabasePath(workspaceKey: string): string {
  return join(getWorkspaceDir(workspaceKey), "review.sqlite");
}

/**
 * Hash workspace path to get stable key
 */
export function hashWorkspaceKey(workspacePath: string): string {
  return createHash("sha256").update(workspacePath).digest("hex").slice(0, 16);
}

/**
 * Get canonical workspace path (realpath)
 */
export async function getCanonicalPath(workspacePath: string): Promise<string> {
  try {
    const { realpathSync } = await import("node:fs");
    return realpathSync(workspacePath);
  } catch {
    return workspacePath;
  }
}

/**
 * Validate review request and compute deduplication key
 */
export function validateAndHashRequest(request: ReviewRequest): {
  valid: boolean;
  error?: string;
  inputHash?: string;
  workspaceKey?: string;
  canonicalWorkspace?: string;
} {
  if (!request.requestId) {
    return { valid: false, error: "requestId is required" };
  }
  if (!request.input?.workspacePath) {
    return { valid: false, error: "workspacePath is required" };
  }

  const workspaceKey = hashWorkspaceKey(request.input.workspacePath);
  const inputHash = createHash("sha256")
    .update(JSON.stringify(request.input))
    .digest("hex")
    .slice(0, 32);

  return {
    valid: true,
    inputHash,
    workspaceKey,
    canonicalWorkspace: request.input.workspacePath,
  };
}

/**
 * Convert internal job record to API response
 */
export function toStatusResponse(job: ReviewJobRecord): ReviewStatusResponse {
  return {
    jobId: job.jobId,
    status: job.status,
    verdict: job.verdict,
    findings: job.findings as ReviewStatusResponse["findings"],
    summary: job.summary,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

/**
 * Create new job record from request
 */
export function createJobRecord(
  jobId: string,
  request: ReviewRequest,
  validation: ReturnType<typeof validateAndHashRequest>
): ReviewJobRecord {
  const now = new Date().toISOString();
  return {
    jobId,
    requestId: request.requestId,
    workspacePath: request.input.workspacePath,
    canonicalWorkspace: validation.canonicalWorkspace!,
    workspaceKey: validation.workspaceKey!,
    inputHash: validation.inputHash!,
    provider: request.provider,
    model: request.model,
    maxPasses: request.maxPasses ?? 5,
    maxToolCalls: request.maxToolCalls ?? 100,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Job status constants
 */
export const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
