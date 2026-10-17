/**
 * Durable Review Worker
 *
 * Node worker entry point with exclusive ownership and Harness integration.
 */
import type { ReviewRequest, ReviewStatusResponse } from "./types.js";
/**
 * Try to acquire exclusive ownership of the workspace database
 * Uses a simple file-based lock with stale detection
 */
export declare function tryAcquireOwnership(workspaceKey: string, workerId: string): Promise<{
    acquired: boolean;
    existingOwner?: string;
}>;
/**
 * Release ownership of the workspace database
 */
export declare function releaseOwnership(workspaceKey: string, workerId: string): Promise<void>;
/**
 * Start the worker for a workspace
 */
export declare function startWorker(workspacePath: string): Promise<{
    success: boolean;
    workerId?: string;
    workspaceKey?: string;
    error?: string;
}>;
/**
 * Stop the worker
 */
export declare function stopWorker(): Promise<void>;
/**
 * Check if worker is ready
 */
export declare function checkWorkerReady(): Promise<{
    ready: boolean;
    workerId?: string;
    workspaceKey?: string;
    error?: string;
}>;
/**
 * Handle incoming review request
 */
export declare function handleReviewRequest(request: ReviewRequest): Promise<{
    jobId: string;
    status: ReviewStatusResponse;
}>;
/**
 * Get status of a review job
 */
export declare function getJobStatus(_jobId: string): Promise<ReviewStatusResponse | null>;
/**
 * Cancel a review job
 */
export declare function cancelJob(_jobId: string): Promise<boolean>;
//# sourceMappingURL=worker.d.ts.map