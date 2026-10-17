/**
 * Durable Review Worker
 *
 * Node worker entry point with exclusive ownership and Harness integration.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getWorkspaceDir, hashWorkspaceKey, validateAndHashRequest, toStatusResponse, createJobRecord, } from "./service.js";
/**
 * Current worker state
 */
let currentWorker = null;
/**
 * Get lock file path for ownership
 */
function getLockPath(workspaceKey) {
    return join(getWorkspaceDir(workspaceKey), ".worker.lock");
}
/**
 * Try to acquire exclusive ownership of the workspace database
 * Uses a simple file-based lock with stale detection
 */
export async function tryAcquireOwnership(workspaceKey, workerId) {
    const lockPath = getLockPath(workspaceKey);
    const lockDir = getWorkspaceDir(workspaceKey);
    // Ensure directory exists
    if (!existsSync(lockDir)) {
        mkdirSync(lockDir, { recursive: true });
    }
    try {
        // Check if lock exists
        if (existsSync(lockPath)) {
            const existing = JSON.parse(readFileSync(lockPath, "utf-8"));
            // If same worker, we already own it
            if (existing.workerId === workerId) {
                return { acquired: true };
            }
            // Check if lock is stale (older than 60 seconds)
            const lockAge = Date.now() - existing.startedAt;
            if (lockAge < 60_000) {
                // Lock is recent, someone else owns it
                return { acquired: false, existingOwner: existing.workerId };
            }
            // Lock is stale, we can take over
        }
        // Write new lock file
        const lockContent = {
            workerId,
            pid: process.pid,
            startedAt: Date.now(),
        };
        writeFileSync(lockPath, JSON.stringify(lockContent), "utf-8");
        return { acquired: true };
    }
    catch (error) {
        console.error("Error acquiring lock:", error);
        return { acquired: false };
    }
}
/**
 * Release ownership of the workspace database
 */
export async function releaseOwnership(workspaceKey, workerId) {
    const lockPath = getLockPath(workspaceKey);
    try {
        if (existsSync(lockPath)) {
            const existing = JSON.parse(readFileSync(lockPath, "utf-8"));
            if (existing.workerId === workerId) {
                unlinkSync(lockPath);
            }
        }
    }
    catch {
        // Ignore errors on release
    }
}
/**
 * Start the worker for a workspace
 */
export async function startWorker(workspacePath) {
    const canonicalPath = workspacePath; // TODO: resolve realpath
    const workspaceKey = hashWorkspaceKey(canonicalPath);
    const workerId = `worker-${randomUUID().slice(0, 8)}`;
    // Try to acquire ownership
    const lockResult = await tryAcquireOwnership(workspaceKey, workerId);
    if (!lockResult.acquired) {
        return {
            success: false,
            error: `Workspace is owned by ${lockResult.existingOwner || "another worker"}. Stop it first or try again later.`,
        };
    }
    // Set up worker state
    currentWorker = {
        workerId,
        workspaceKey,
        ready: true,
    };
    return { success: true, workerId, workspaceKey };
}
/**
 * Stop the worker
 */
export async function stopWorker() {
    if (currentWorker) {
        await releaseOwnership(currentWorker.workspaceKey, currentWorker.workerId);
        currentWorker = null;
    }
}
/**
 * Check if worker is ready
 */
export async function checkWorkerReady() {
    if (!currentWorker) {
        return { ready: false, error: "No worker started" };
    }
    if (!currentWorker.ready) {
        return { ready: false, workerId: currentWorker.workerId, error: "Worker not ready" };
    }
    return {
        ready: true,
        workerId: currentWorker.workerId,
        workspaceKey: currentWorker.workspaceKey,
    };
}
/**
 * Handle incoming review request
 */
export async function handleReviewRequest(request) {
    const validation = validateAndHashRequest(request);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    const workspaceKey = validation.workspaceKey;
    // Ensure worker is for the right workspace
    if (!currentWorker || currentWorker.workspaceKey !== workspaceKey) {
        throw new Error(`Worker is not running for this workspace. Start worker with: startWorker("${request.input.workspacePath}")`);
    }
    // Generate job ID
    const jobId = `review-${randomUUID().slice(0, 8)}`;
    // Create job record
    const jobRecord = createJobRecord(jobId, request, validation);
    // TODO: Persist job to Harness storage and start review
    return {
        jobId,
        status: toStatusResponse(jobRecord),
    };
}
/**
 * Get status of a review job
 */
export async function getJobStatus(_jobId) {
    // TODO: Implement actual retrieval from Harness storage
    return null;
}
/**
 * Cancel a review job
 */
export async function cancelJob(_jobId) {
    // TODO: Implement cancellation
    return false;
}
//# sourceMappingURL=worker.js.map