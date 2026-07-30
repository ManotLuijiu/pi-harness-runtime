import type { TaskLease } from "./types.js";
export declare class LeaseError extends Error {
    constructor(msg: string);
}
/** Default lease duration before heartbeat extension is required. */
export declare const DEFAULT_LEASE_TTL_MS = 30000;
/** Heartbeat interval sent by the worker. */
export declare const HEARTBEAT_INTERVAL_MS = 5000;
/** Default worker heartbeat interval extension. */
export declare const HEARTBEAT_EXTENSION_MS = 30000;
export interface LeaseOptions {
    leasesDir?: string;
    /** TTL in ms for new leases. Default: DEFAULT_LEASE_TTL_MS */
    leaseTtlMs?: number;
}
/**
 * Manages task leases on disk using atomic write-tmp-then-rename.
 */
export declare class LeaseManager {
    private readonly leasesDir;
    private readonly leaseTtlMs;
    constructor(options?: LeaseOptions);
    /** Ensure the claimed/ directory exists. */
    ensureDir(): void;
    /**
     * Atomically claim a task for a worker.
     *
     * Algorithm:
     * 1. Write lease to a temp file in the same directory (same filesystem → fast rename)
     * 2. Attempt atomic rename to `claimed/<taskId>.lease.json`
     * 3. If rename fails (EEXIST) → another worker won → return null
     *
     * @param taskId    The task to claim
     * @param workerId  The worker claiming it
     * @param attempt   Which attempt number (for retry)
     * @returns The TaskLease if won, null if another worker claimed first
     */
    claim(taskId: string, workerId: string, attempt?: number): TaskLease | null;
    /**
     * Extend a lease's expiry time.
     * Only the worker that holds the lease can extend it.
     *
     * @returns Updated lease, or null if the lease no longer exists
     */
    heartbeat(taskId: string, workerId: string): TaskLease | null;
    /**
     * Explicitly release a lease (task completed or failed without retry).
     */
    release(taskId: string, workerId: string): void;
    /** Read a lease by taskId. Returns null if not found. */
    get(taskId: string): TaskLease | null;
    /** Check if a lease has expired (expiresAt is in the past). */
    isExpired(lease: TaskLease): boolean;
    /**
     * Scan all leases and return the ones that have expired.
     * Does NOT remove them — call reapAndRelease() to remove atomically.
     */
    reap(): TaskLease[];
    /**
     * Release all expired leases and return their taskIds.
     * Idempotent — safe to call on every heartbeat interval.
     */
    reapAndRelease(): string[];
    /**
     * On worker startup, release any leases held by dead workers.
     * A lease is orphaned if its worker has not re-claimed it since startup.
     *
     * Strategy: remove all leases whose expiresAt has passed.
     * Safe because the next claim will succeed (no other worker holds it).
     */
    recoverOnStartup(): string[];
    /** Return all active (non-expired) leases. */
    listActive(): TaskLease[];
    private _leasePath;
    private _writeLease;
    private _removeLease;
}
//# sourceMappingURL=lease.d.ts.map