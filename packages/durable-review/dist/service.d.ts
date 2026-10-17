/**
 * Durable Review Service
 *
 * Harness lifecycle, admission, status, cancellation and recovery.
 */
import type { ReviewRequest, ReviewStatusResponse } from "./types.js";
import type { ReviewJobRecord } from "./documents.js";
/**
 * Get workspace-specific directory
 */
export declare function getWorkspaceDir(workspaceKey: string): string;
/**
 * Get SQLite database path for workspace
 */
export declare function getDatabasePath(workspaceKey: string): string;
/**
 * Hash workspace path to get stable key
 */
export declare function hashWorkspaceKey(workspacePath: string): string;
/**
 * Get canonical workspace path (realpath)
 */
export declare function getCanonicalPath(workspacePath: string): Promise<string>;
/**
 * Validate review request and compute deduplication key
 */
export declare function validateAndHashRequest(request: ReviewRequest): {
    valid: boolean;
    error?: string;
    inputHash?: string;
    workspaceKey?: string;
    canonicalWorkspace?: string;
};
/**
 * Convert internal job record to API response
 */
export declare function toStatusResponse(job: ReviewJobRecord): ReviewStatusResponse;
/**
 * Create new job record from request
 */
export declare function createJobRecord(jobId: string, request: ReviewRequest, validation: ReturnType<typeof validateAndHashRequest>): ReviewJobRecord;
/**
 * Job status constants
 */
export declare const JOB_STATUS: {
    readonly QUEUED: "queued";
    readonly RUNNING: "running";
    readonly COMPLETED: "completed";
    readonly FAILED: "failed";
    readonly CANCELLED: "cancelled";
};
//# sourceMappingURL=service.d.ts.map