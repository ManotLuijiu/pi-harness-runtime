/**
 * Durable Review Client
 *
 * Pi-to-worker client, readiness and connection errors.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hashWorkspaceKey, getWorkspaceDir } from "./service.js";
/**
 * Client error types
 */
export class ClientError extends Error {
    constructor(message) {
        super(message);
        this.name = "ClientError";
    }
}
export class NotReadyError extends ClientError {
    constructor(message = "Worker is not ready") {
        super(message);
        this.name = "NotReadyError";
    }
}
export class BusyError extends ClientError {
    constructor(message = "Worker is busy with another review") {
        super(message);
        this.name = "BusyError";
    }
}
/**
 * Get worker socket path for workspace
 */
function getWorkerSocketPath(workspaceKey) {
    return join(getWorkspaceDir(workspaceKey), ".worker.sock");
}
/**
 * Check if worker is running for workspace
 */
export function isWorkerRunning(workspaceKey) {
    const socketPath = getWorkerSocketPath(workspaceKey);
    // Simple check - socket file exists
    // In production, would use actual socket connectivity check
    return existsSync(socketPath);
}
/**
 * Submit review request to worker
 */
export async function submitReviewRequest(request) {
    const workspaceKey = hashWorkspaceKey(request.input.workspacePath);
    if (!isWorkerRunning(workspaceKey)) {
        throw new NotReadyError(`No worker running for workspace. Start worker first or set HARNESS_DURABLE_REVIEW=1.`);
    }
    // TODO: Implement actual IPC to worker
    // For now, return a placeholder
    throw new ClientError("IPC to worker not yet implemented");
}
/**
 * Get review job status
 */
export async function getReviewStatus(jobId, workspacePath) {
    // TODO: Implement actual status retrieval
    return null;
}
/**
 * Cancel a review job
 */
export async function cancelReview(jobId, workspacePath) {
    // TODO: Implement actual cancellation
    return false;
}
/**
 * Check worker readiness
 */
export async function checkWorkerReady(workspacePath) {
    const workspaceKey = hashWorkspaceKey(workspacePath);
    if (!isWorkerRunning(workspaceKey)) {
        return {
            ready: false,
            error: "No worker running for this workspace",
        };
    }
    // TODO: Implement actual readiness check via IPC
    return {
        ready: true,
        pendingJobs: 0,
    };
}
//# sourceMappingURL=client.js.map