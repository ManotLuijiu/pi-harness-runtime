/**
 * Durable Review Worker
 *
 * Node worker entry point with proper exclusive ownership and Harness integration.
 * Uses atomic lock acquisition (mkdir) and process liveness verification.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewRequest, ReviewStatusResponse } from "./types.js";
import { getDatabasePath, getWorkspaceDir, hashWorkspaceKey, validateAndHashRequest, toStatusResponse, createJobRecord } from "./service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Worker instance state
 */
interface WorkerState {
  workerId: string;
  workspaceKey: string;
  harness: unknown; // Harness instance
  storage: unknown; // SQLite storage
  ready: boolean;
}

/**
 * Lock file content
 */
interface LockContent {
  workerId: string;
  pid: number;
  startedAt: number;
  lockId: string; // Unique lock identifier for atomic verification
}

/**
 * Current worker state
 */
let currentWorker: WorkerState | null = null;

/**
 * Lock acquisition result
 */
interface LockResult {
  acquired: boolean;
  existingOwner?: string;
  staleLock?: boolean;
}

// ---------------------------------------------------------------------------
// Atomic Lock Operations
// ---------------------------------------------------------------------------

/**
 * Get lock file path for workspace
 * Single lock file per workspace - only one worker can hold it at a time
 */
function getLockPath(workspaceKey: string): string {
  return join(getWorkspaceDir(workspaceKey), ".worker.lock");
}

/**
 * Check if a process is alive (Unix)
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Unix: sending signal 0 checks if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify lock owner is still alive
 */
function verifyOwnerAlive(lock: LockContent): boolean {
  if (lock.pid === process.pid) {
    return true; // Same process
  }
  return isProcessAlive(lock.pid);
}

/**
 * Try to acquire exclusive ownership using file creation
 *
 * Uses exclusive file creation for atomic lock acquisition.
 * The process must be alive (verified by PID check) before taking over a stale lock.
 */
export async function tryAcquireOwnership(
  workspaceKey: string,
  workerId: string
): Promise<LockResult> {
  const lockDir = join(getWorkspaceDir(workspaceKey), "locks");
  const lockPath = getLockPath(workspaceKey);
  const lockContent: LockContent = {
    workerId,
    pid: process.pid,
    startedAt: Date.now(),
    lockId: randomUUID(), // Unique ID for this lock instance
  };

  // Ensure lock directory exists
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }

  try {
    // Check if our lock file already exists
    if (existsSync(lockPath)) {
      const existing = JSON.parse(readFileSync(lockPath, "utf8")) as LockContent;

      // Same worker - we already have the lock
      if (existing.workerId === workerId && existing.pid === process.pid) {
        console.log("[lock] Same worker, returning acquired");
        return { acquired: true };
      }

      // Different worker - check if owner is still alive
      if (verifyOwnerAlive(existing)) {
        // Owner is alive, we can't take the lock
        return { acquired: false, existingOwner: existing.workerId };
      }

      // Owner is dead - we can take over
      // Write new lock content atomically via rename
      const tmpPath = lockPath + ".tmp." + process.pid;
      writeFileSync(tmpPath, JSON.stringify(lockContent), "utf8");
      try {
        // Rename is atomic on POSIX when destination is on same filesystem
        // This takes over the lock
        const { renameSync } = await import("node:fs");
        renameSync(tmpPath, lockPath);
        return { acquired: true, staleLock: true };
      } catch {
        // Takeover failed (another process beat us)
        try { unlinkSync(tmpPath); } catch { /* ignore */ }
        return { acquired: false, existingOwner: existing.workerId };
      }
    }

    // Lock doesn't exist - create it atomically
    // Use writeFileSync with flag 'wx' for exclusive create
    const { writeFileSync: wfSync } = await import("node:fs");
    wfSync(lockPath, JSON.stringify(lockContent), { flag: "wx" });
    return { acquired: true };
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EEXIST") {
      // Race: another process created it first
      try {
        const existing = JSON.parse(readFileSync(lockPath, "utf8")) as LockContent;
        if (verifyOwnerAlive(existing)) {
          return { acquired: false, existingOwner: existing.workerId };
        }
        // Owner is dead, try takeover
        const takeoverContent: LockContent = {
          ...lockContent,
          lockId: randomUUID(),
        };
        const tmpPath = lockPath + ".tmp." + process.pid;
        writeFileSync(tmpPath, JSON.stringify(takeoverContent), "utf8");
        try {
          const { renameSync } = await import("node:fs");
          renameSync(tmpPath, lockPath);
          return { acquired: true, staleLock: true };
        } catch {
          try { unlinkSync(tmpPath); } catch { /* ignore */ }
          return { acquired: false, existingOwner: existing.workerId };
        }
      } catch {
        return { acquired: false };
      }
    }

    // Other error
    console.error("[durable-review] Lock acquisition error:", error);
    return { acquired: false };
  }
}

/**
 * Release ownership of the workspace database
 */
export async function releaseOwnership(workspaceKey: string, workerId: string): Promise<void> {
  const lockPath = getLockPath(workspaceKey);

  try {
    if (existsSync(lockPath)) {
      const existing = JSON.parse(readFileSync(lockPath, "utf8")) as LockContent;
      if (existing.workerId === workerId) {
        unlinkSync(lockPath);
      }
    }
  } catch {
    // Ignore errors on release
  }
}

/**
 * Verify we still hold the lock (for worker health checks)
 */
export function verifyLockOwnership(workspaceKey: string, workerId: string): boolean {
  const lockPath = getLockPath(workspaceKey);
  try {
    if (!existsSync(lockPath)) return false;
    const existing = JSON.parse(readFileSync(lockPath, "utf8")) as LockContent;
    return existing.workerId === workerId && existing.pid === process.pid;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Worker Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the worker for a workspace
 */
export async function startWorker(workspacePath: string): Promise<{
  success: boolean;
  workerId?: string;
  workspaceKey?: string;
  harness?: unknown;
  error?: string;
}> {
  const canonicalPath = workspacePath;
  const workspaceKey = hashWorkspaceKey(canonicalPath);
  const workerId = `worker-${randomUUID().slice(0, 8)}`;

  // Try to acquire exclusive ownership
  const lockResult = await tryAcquireOwnership(workspaceKey, workerId);
  if (!lockResult.acquired) {
    return {
      success: false,
      error: `Workspace is owned by ${lockResult.existingOwner || "another worker"}. Stop it first or try again later.`,
    };
  }

  if (lockResult.staleLock) {
    console.log(`[durable-review] Took over stale lock from ${lockResult.existingOwner}`);
  }

  try {
    // Open SQLite storage using pi-durable's Node adapter
    const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
    const dbPath = getDatabasePath(workspaceKey);
    const storage = await openNodeSqliteStorage(dbPath);

    // Create registry with reviewer extension
    const { createRegistry } = await import("@earendil-works/pi-durable");
    const registry = createRegistry();

    // Open Harness with storage
    const { Harness: HarnessClass } = await import("@earendil-works/pi-durable");
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const harness = await (HarnessClass as any).open(storage, { registry }, BACKGROUND_CONTEXT);

    currentWorker = {
      workerId,
      workspaceKey,
      harness,
      storage,
      ready: true,
    };

    return { success: true, workerId, workspaceKey, harness };
  } catch (err) {
    // Release lock on failure
    await releaseOwnership(workspaceKey, workerId);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Stop the worker
 */
export async function stopWorker(): Promise<void> {
  if (currentWorker) {
    try {
      const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
      if (currentWorker.harness) {
        await (currentWorker.harness as { close: (ctx: unknown) => Promise<void> }).close(BACKGROUND_CONTEXT);
      }
    } catch {
      // Ignore close errors
    }

    await releaseOwnership(currentWorker.workspaceKey, currentWorker.workerId);
    currentWorker = null;
  }
}

/**
 * Check if worker is ready
 */
export async function checkWorkerReady(): Promise<{
  ready: boolean;
  workerId?: string;
  workspaceKey?: string;
  error?: string;
}> {
  if (!currentWorker) {
    return { ready: false, error: "No worker started" };
  }

  if (!currentWorker.ready) {
    return { ready: false, workerId: currentWorker.workerId, error: "Worker not ready" };
  }

  // Verify we still hold the lock
  if (!verifyLockOwnership(currentWorker.workspaceKey, currentWorker.workerId)) {
    currentWorker = null;
    return { ready: false, error: "Lock lost" };
  }

  return {
    ready: true,
    workerId: currentWorker.workerId,
    workspaceKey: currentWorker.workspaceKey,
  };
}

// ---------------------------------------------------------------------------
// Review Operations
// ---------------------------------------------------------------------------

/**
 * Handle incoming review request
 */
export async function handleReviewRequest(
  request: ReviewRequest
): Promise<{ jobId: string; status: ReviewStatusResponse }> {
  const validation = validateAndHashRequest(request);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const workspaceKey = validation.workspaceKey!;

  // Ensure worker is for the right workspace
  if (!currentWorker || currentWorker.workspaceKey !== workspaceKey) {
    throw new Error(
      `Worker is not running for this workspace. Start worker with: startWorker("${request.input.workspacePath}")`
    );
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
export async function getJobStatus(_jobId: string): Promise<ReviewStatusResponse | null> {
  // TODO: Implement actual retrieval from Harness storage
  return null;
}

/**
 * Cancel a review job
 */
export async function cancelJob(_jobId: string): Promise<boolean> {
  // TODO: Implement cancellation
  return false;
}
