/**
 * Durable Review Documents
 *
 * Versioned durable documents for review/job index using pi-durable's defineDoc.
 * Uses chord's JsonValue for JSON-compatible types.
 */

import { defineDoc } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";

/**
 * Schema version for migration support
 */
export const SCHEMA_VERSION = 1;

/**
 * Finding record - plain interface for internal use
 */
export interface FindingRecord {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  endLine?: number;
}

/**
 * Review job record - plain interface for internal use
 */
export interface ReviewJobRecord {
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
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  verdict?: "approved" | "changes_requested" | "blocked";
  findings?: JsonValue;
  summary?: string;
  error?: string;
  reportId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/**
 * Jobs index document value - chord JsonObject compatible
 */
export type JobsIndexValue = {
  schemaVersion: number;
  jobs: Record<string, JsonValue>;
};

/**
 * Worker ownership document value - chord JsonObject compatible
 */
export type WorkerOwnerValue = {
  ownerId: string;
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
};

/**
 * Review job index document - task-scoped
 */
export const ReviewJobDoc = defineDoc({
  kind: "moocoding.durable-review.jobs",
  version: 1,
  scope: "task",
  initial: (): JobsIndexValue => ({
    schemaVersion: SCHEMA_VERSION,
    jobs: {},
  }),
});

/**
 * Worker ownership document - task-scoped
 */
export const WorkerOwnerDoc = defineDoc({
  kind: "moocoding.durable-review.owner",
  version: 1,
  scope: "task",
  initial: (): WorkerOwnerValue => ({
    ownerId: "",
    pid: 0,
    startedAt: "",
    lastHeartbeat: "",
  }),
});

/**
 * Get job from document
 */
export function getJobFromDoc(
  doc: JobsIndexValue | undefined,
  jobId: string
): ReviewJobRecord | undefined {
  const job = doc?.jobs?.[jobId];
  if (!job || typeof job !== "object") return undefined;
  try {
    return JSON.parse(JSON.stringify(job)) as ReviewJobRecord;
  } catch {
    return undefined;
  }
}

/**
 * Update job in document
 */
export function updateJobInDoc(
  doc: JobsIndexValue,
  jobId: string,
  job: ReviewJobRecord
): JobsIndexValue {
  return {
    schemaVersion: doc.schemaVersion,
    jobs: {
      ...doc.jobs,
      // SAFETY: job is already JSON-compatible
      [jobId]: job as unknown as JsonValue,
    },
  };
}
