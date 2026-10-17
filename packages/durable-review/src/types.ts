/**
 * Durable Review Types
 *
 * Public request/status/result types and validators.
 */

import { Type, type Static } from "typebox";

/**
 * Review job status
 */
export type ReviewStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Review verdict
 */
export type Verdict = "approved" | "changes_requested" | "blocked";

/**
 * Finding from the reviewer
 */
export interface Finding {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  endLine?: number;
}

/**
 * Review input content
 */
export interface ReviewInput {
  workspacePath: string;
  diff?: string;
  stagedChanges?: string;
  unstagedChanges?: string;
  selectedFiles?: string[];
  baseCommit?: string;
  prompt?: string;
}

/**
 * Review request
 */
export interface ReviewRequest {
  requestId: string; // Caller-provided deduplication key
  input: ReviewInput;
  provider?: string;
  model?: string;
  maxPasses?: number;
  maxToolCalls?: number;
}

/**
 * Review job status record
 */
export interface ReviewJob {
  jobId: string;
  requestId: string;
  workspacePath: string;
  canonicalWorkspace: string;
  workspaceKey: string;
  inputHash: string;
  inputSnapshotId?: string;
  provider?: string;
  model?: string;
  maxPasses: number;
  maxToolCalls: number;
  conversationId?: string;
  submissionId?: string;
  status: ReviewStatus;
  verdict?: Verdict;
  findings?: Finding[];
  summary?: string;
  error?: string;
  reportId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Review result (completed job)
 */
export interface ReviewResult {
  jobId: string;
  requestId: string;
  verdict: Verdict;
  findings: Finding[];
  summary: string;
  reportId: string;
  completedAt: string;
}

/**
 * Review status response
 */
export interface ReviewStatusResponse {
  jobId: string;
  status: ReviewStatus;
  verdict?: Verdict;
  findings?: Finding[];
  summary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Worker ready response
 */
export interface WorkerReadyResponse {
  ready: boolean;
  workspaceKey?: string;
  pendingJobs?: number;
  error?: string;
}

/**
 * TypeBox schemas for validation
 */
export const ReviewRequestSchema = Type.Object({
  requestId: Type.String({ minLength: 1 }),
  input: Type.Object({
    workspacePath: Type.String({ minLength: 1 }),
    diff: Type.Optional(Type.String()),
    stagedChanges: Type.Optional(Type.String()),
    unstagedChanges: Type.Optional(Type.String()),
    selectedFiles: Type.Optional(Type.Array(Type.String())),
    baseCommit: Type.Optional(Type.String()),
    prompt: Type.Optional(Type.String()),
  }),
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  maxPasses: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
  maxToolCalls: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
});

export type ReviewRequestInput = Static<typeof ReviewRequestSchema>;

/**
 * Validate a review request
 */
export function validateReviewRequest(input: unknown): {
  valid: boolean;
  error?: string;
  request?: ReviewRequest;
} {
  try {
    // Simple validation without TypeBox runtime for now
    const req = input as ReviewRequest;
    if (!req.requestId || typeof req.requestId !== "string") {
      return { valid: false, error: "requestId is required" };
    }
    if (!req.input || typeof req.input !== "object") {
      return { valid: false, error: "input is required" };
    }
    if (!req.input.workspacePath || typeof req.input.workspacePath !== "string") {
      return { valid: false, error: "workspacePath is required" };
    }
    return {
      valid: true,
      request: {
        requestId: req.requestId,
        input: req.input,
        provider: req.provider,
        model: req.model,
        maxPasses: req.maxPasses ?? 5,
        maxToolCalls: req.maxToolCalls ?? 100,
      },
    };
  } catch (e) {
    return { valid: false, error: String(e) };
  }
}
