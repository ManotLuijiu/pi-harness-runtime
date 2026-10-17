/**
 * Durable Review Client
 *
 * Pi-to-worker client, readiness and connection errors.
 */
import type { ReviewRequest, ReviewStatusResponse } from "./types.js";
/**
 * Client error types
 */
export declare class ClientError extends Error {
    constructor(message: string);
}
export declare class NotReadyError extends ClientError {
    constructor(message?: string);
}
export declare class BusyError extends ClientError {
    constructor(message?: string);
}
/**
 * Check if worker is running for workspace
 */
export declare function isWorkerRunning(workspaceKey: string): boolean;
/**
 * Submit review request to worker
 */
export declare function submitReviewRequest(request: ReviewRequest): Promise<{
    jobId: string;
    status: ReviewStatusResponse;
}>;
/**
 * Get review job status
 */
export declare function getReviewStatus(jobId: string, workspacePath: string): Promise<ReviewStatusResponse | null>;
/**
 * Cancel a review job
 */
export declare function cancelReview(jobId: string, workspacePath: string): Promise<boolean>;
/**
 * Check worker readiness
 */
export declare function checkWorkerReady(workspacePath: string): Promise<{
    ready: boolean;
    pendingJobs?: number;
    error?: string;
}>;
//# sourceMappingURL=client.d.ts.map