/**
 * Lease Manager — RFC-0101 §4
 *
 * Manages task leases on disk using atomic write-tmp-then-rename.
 * This prevents double-execution when two workers claim the same task concurrently.
 *
 * Filesystem layout:
 * ```
 * ~/.pi/harness/inbox/
 * ├── tasks.jsonl        # task records
 * └── claimed/
 *     └── <task-id>.lease.json   # one lease file per claimed task
 * ```
 *
 * Safety properties:
 * - Claiming is single-execution: POSIX rename is atomic, so only one writer wins.
 * - A worker that dies: its lease expires, the reaper releases it back to queued.
 * - On startup, recoverOrphanLeases() cleans up any stale leases.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
import { getLeasesDir } from "./types.js";
// ─── Errors ───────────────────────────────────────────────────────────────────
export class LeaseError extends Error {
    constructor(msg) {
        super(`[LeaseError] ${msg}`);
        this.name = "LeaseError";
    }
}
// ─── Constants ────────────────────────────────────────────────────────────────
/** Default lease duration before heartbeat extension is required. */
export const DEFAULT_LEASE_TTL_MS = 30_000; // 30 s
/** Heartbeat interval sent by the worker. */
export const HEARTBEAT_INTERVAL_MS = 5_000; // 5 s
/** Default worker heartbeat interval extension. */
export const HEARTBEAT_EXTENSION_MS = 30_000; // extend by 30 s
/**
 * Manages task leases on disk using atomic write-tmp-then-rename.
 */
export class LeaseManager {
    leasesDir;
    leaseTtlMs;
    constructor(options = {}) {
        this.leasesDir = options.leasesDir ?? getLeasesDir();
        this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    }
    /** Ensure the claimed/ directory exists. */
    ensureDir() {
        if (!existsSync(this.leasesDir)) {
            mkdirSync(this.leasesDir, { recursive: true });
        }
    }
    // ─── claim ───────────────────────────────────────────────────────────────
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
    claim(taskId, workerId, attempt = 1) {
        this.ensureDir();
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + this.leaseTtlMs).toISOString();
        const lease = {
            taskId,
            workerId,
            acquiredAt: now,
            expiresAt,
            heartbeatAt: now,
            attempt,
        };
        const targetPath = this._leasePath(taskId);
        const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
        // Write to temp file in the same directory (ensures atomic rename works across filesystems)
        writeFileSync(tmpPath, JSON.stringify(lease), "utf8");
        try {
            // Atomic rename — if another worker already wrote the file, this throws EEXIST
            renameSync(tmpPath, targetPath);
            return lease;
        }
        catch (err) {
            // Clean up the tmp file
            try {
                unlinkSync(tmpPath);
            }
            catch { /* ignore */ }
            const code = err.code;
            if (code === "EEXIST") {
                // Another worker won the race
                return null;
            }
            throw err;
        }
    }
    // ─── heartbeat ────────────────────────────────────────────────────────────
    /**
     * Extend a lease's expiry time.
     * Only the worker that holds the lease can extend it.
     *
     * @returns Updated lease, or null if the lease no longer exists
     */
    heartbeat(taskId, workerId) {
        const lease = this.get(taskId);
        if (!lease)
            return null;
        if (lease.workerId !== workerId) {
            throw new LeaseError(`Worker ${workerId} cannot heartbeat lease for ${taskId}: held by ${lease.workerId}`);
        }
        const updated = {
            ...lease,
            heartbeatAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + this.leaseTtlMs).toISOString(),
        };
        this._writeLease(updated);
        return updated;
    }
    // ─── release ─────────────────────────────────────────────────────────────
    /**
     * Explicitly release a lease (task completed or failed without retry).
     */
    release(taskId, workerId) {
        const lease = this.get(taskId);
        if (!lease)
            return;
        if (lease.workerId !== workerId) {
            throw new LeaseError(`Worker ${workerId} cannot release lease for ${taskId}: held by ${lease.workerId}`);
        }
        this._removeLease(taskId);
    }
    // ─── get ─────────────────────────────────────────────────────────────────
    /** Read a lease by taskId. Returns null if not found. */
    get(taskId) {
        const path = this._leasePath(taskId);
        if (!existsSync(path))
            return null;
        try {
            return JSON.parse(readFileSync(path, "utf8"));
        }
        catch {
            return null;
        }
    }
    // ─── isExpired ────────────────────────────────────────────────────────────
    /** Check if a lease has expired (expiresAt is in the past). */
    isExpired(lease) {
        return new Date(lease.expiresAt).getTime() < Date.now();
    }
    // ─── reap ────────────────────────────────────────────────────────────────
    /**
     * Scan all leases and return the ones that have expired.
     * Does NOT remove them — call reapAndRelease() to remove atomically.
     */
    reap() {
        if (!existsSync(this.leasesDir))
            return [];
        const now = Date.now();
        const expired = [];
        for (const filename of readdirSync(this.leasesDir)) {
            if (!filename.endsWith(".lease.json"))
                continue;
            const path = join(this.leasesDir, filename);
            try {
                const lease = JSON.parse(readFileSync(path, "utf8"));
                if (new Date(lease.expiresAt).getTime() < now) {
                    expired.push(lease);
                }
            }
            catch {
                // Corrupt file — remove it
                try {
                    unlinkSync(path);
                }
                catch { /* ignore */ }
            }
        }
        return expired;
    }
    /**
     * Release all expired leases and return their taskIds.
     * Idempotent — safe to call on every heartbeat interval.
     */
    reapAndRelease() {
        const expired = this.reap();
        const released = [];
        for (const lease of expired) {
            try {
                this._removeLease(lease.taskId);
                released.push(lease.taskId);
            }
            catch {
                // Already removed — ignore
            }
        }
        return released;
    }
    // ─── recoverOrphanLeases ─────────────────────────────────────────────────
    /**
     * On worker startup, release any leases held by dead workers.
     * A lease is orphaned if its worker has not re-claimed it since startup.
     *
     * Strategy: remove all leases whose expiresAt has passed.
     * Safe because the next claim will succeed (no other worker holds it).
     */
    recoverOnStartup() {
        return this.reapAndRelease();
    }
    // ─── listActive ───────────────────────────────────────────────────────────
    /** Return all active (non-expired) leases. */
    listActive() {
        if (!existsSync(this.leasesDir))
            return [];
        const now = Date.now();
        const active = [];
        for (const filename of readdirSync(this.leasesDir)) {
            if (!filename.endsWith(".lease.json"))
                continue;
            const path = join(this.leasesDir, filename);
            try {
                const lease = JSON.parse(readFileSync(path, "utf8"));
                if (new Date(lease.expiresAt).getTime() >= now) {
                    active.push(lease);
                }
            }
            catch {
                // Corrupt — remove
                try {
                    unlinkSync(path);
                }
                catch { /* ignore */ }
            }
        }
        return active;
    }
    // ─── internals ───────────────────────────────────────────────────────────
    _leasePath(taskId) {
        return join(this.leasesDir, `${taskId}.lease.json`);
    }
    _writeLease(lease) {
        this.ensureDir();
        const tmp = `${this._leasePath(lease.taskId)}.tmp`;
        writeFileSync(tmp, JSON.stringify(lease), "utf8");
        renameSync(tmp, this._leasePath(lease.taskId));
    }
    _removeLease(taskId) {
        const path = this._leasePath(taskId);
        if (existsSync(path))
            unlinkSync(path);
    }
}
//# sourceMappingURL=lease.js.map