/**
 * Durable Review Worker
 *
 * Node worker entry point with proper exclusive ownership and Harness integration.
 * Uses atomic lock acquisition (mkdir) and process liveness verification.
 */
import type { ReviewRequest, ReviewStatusResponse } from "./types.js";
/**
 * Lock acquisition result
 */
interface LockResult {
    acquired: boolean;
    existingOwner?: string;
    staleLock?: boolean;
}
/**
 * Try to acquire exclusive ownership using file creation
 *
 * Uses exclusive file creation for atomic lock acquisition.
 * The process must be alive (verified by PID check) before taking over a stale lock.
 */
export declare function tryAcquireOwnership(workspaceKey: string, workerId: string): Promise<LockResult>;
/**
 * Release ownership of the workspace database
 */
export declare function releaseOwnership(workspaceKey: string, workerId: string): Promise<void>;
/**
 * Verify we still hold the lock (for worker health checks)
 */
export declare function verifyLockOwnership(workspaceKey: string, workerId: string): boolean;
/**
 * Start the worker for a workspace
 */
export declare function startWorker(workspacePath: string): Promise<{
    success: boolean;
    workerId?: string;
    workspaceKey?: string;
    harness?: unknown;
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
export {};
//# sourceMappingURL=worker.d.ts.map