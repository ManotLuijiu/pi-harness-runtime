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
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import type { TaskLease } from "./types.js";
import { getLeasesDir } from "./types.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class LeaseError extends Error {
	constructor(msg: string) {
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

// ─── LeaseManager ─────────────────────────────────────────────────────────────

export interface LeaseOptions {
	leasesDir?: string;
	/** TTL in ms for new leases. Default: DEFAULT_LEASE_TTL_MS */
	leaseTtlMs?: number;
}

/**
 * Manages task leases on disk using atomic write-tmp-then-rename.
 */
export class LeaseManager {
	private readonly leasesDir: string;
	private readonly leaseTtlMs: number;

	constructor(options: LeaseOptions = {}) {
		this.leasesDir = options.leasesDir ?? getLeasesDir();
		this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
	}

	/** Ensure the claimed/ directory exists. */
	ensureDir(): void {
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
	claim(taskId: string, workerId: string, attempt = 1): TaskLease | null {
		this.ensureDir();

		const now = new Date().toISOString();
		const expiresAt = new Date(Date.now() + this.leaseTtlMs).toISOString();
		const lease: TaskLease = {
			taskId,
			workerId,
			acquiredAt: now,
			expiresAt,
			heartbeatAt: now,
			attempt,
		};

		const targetPath = this._leasePath(taskId);

		// Use open() with O_CREAT | O_EXCL — this is atomic and fails immediately
		// if another worker has already created the lease file. No tmp file needed.
		let fd: number;
		try {
			fd = openSync(targetPath, "wx", 0o644); // mode 0644 = rw-r--r--
		} catch (err: unknown) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "EEXIST") {
				return null; // another worker already claimed
			}
			throw err;
		}

		try {
			writeSync(fd, JSON.stringify(lease) + "\n");
			closeSync(fd);
			return lease;
		} catch (err: unknown) {
			try {
				closeSync(fd);
			} catch {
				/* ignore */
			}
			try {
				unlinkSync(targetPath);
			} catch {
				/* ignore */
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
	heartbeat(taskId: string, workerId: string): TaskLease | null {
		const lease = this.get(taskId);
		if (!lease) return null;
		if (lease.workerId !== workerId) {
			throw new LeaseError(
				`Worker ${workerId} cannot heartbeat lease for ${taskId}: held by ${lease.workerId}`,
			);
		}

		const updated: TaskLease = {
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
	release(taskId: string, workerId: string): void {
		const lease = this.get(taskId);
		if (!lease) return;
		if (lease.workerId !== workerId) {
			throw new LeaseError(
				`Worker ${workerId} cannot release lease for ${taskId}: held by ${lease.workerId}`,
			);
		}
		this._removeLease(taskId);
	}

	// ─── get ─────────────────────────────────────────────────────────────────

	/** Read a lease by taskId. Returns null if not found. */
	get(taskId: string): TaskLease | null {
		const path = this._leasePath(taskId);
		if (!existsSync(path)) return null;
		try {
			return JSON.parse(readFileSync(path, "utf8")) as TaskLease;
		} catch {
			return null;
		}
	}

	// ─── isExpired ────────────────────────────────────────────────────────────

	/** Check if a lease has expired (expiresAt is in the past). */
	isExpired(lease: TaskLease): boolean {
		return new Date(lease.expiresAt).getTime() < Date.now();
	}

	// ─── reap ────────────────────────────────────────────────────────────────

	/**
	 * Scan all leases and return the ones that have expired.
	 * Does NOT remove them — call reapAndRelease() to remove atomically.
	 */
	reap(): TaskLease[] {
		if (!existsSync(this.leasesDir)) return [];
		const now = Date.now();
		const expired: TaskLease[] = [];

		for (const filename of readdirSync(this.leasesDir)) {
			if (!filename.endsWith(".lease.json")) continue;
			const path = join(this.leasesDir, filename);
			try {
				const lease = JSON.parse(readFileSync(path, "utf8")) as TaskLease;
				if (new Date(lease.expiresAt).getTime() < now) {
					expired.push(lease);
				}
			} catch {
				// Corrupt file — remove it
				try {
					unlinkSync(path);
				} catch {
					/* ignore */
				}
			}
		}

		return expired;
	}

	/**
	 * Release all expired leases and return their taskIds.
	 * Idempotent — safe to call on every heartbeat interval.
	 */
	reapAndRelease(): string[] {
		const expired = this.reap();
		const released: string[] = [];
		for (const lease of expired) {
			try {
				this._removeLease(lease.taskId);
				released.push(lease.taskId);
			} catch {
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
	recoverOnStartup(): string[] {
		return this.reapAndRelease();
	}

	// ─── listActive ───────────────────────────────────────────────────────────

	/** Return all active (non-expired) leases. */
	listActive(): TaskLease[] {
		if (!existsSync(this.leasesDir)) return [];
		const now = Date.now();
		const active: TaskLease[] = [];

		for (const filename of readdirSync(this.leasesDir)) {
			if (!filename.endsWith(".lease.json")) continue;
			const path = join(this.leasesDir, filename);
			try {
				const lease = JSON.parse(readFileSync(path, "utf8")) as TaskLease;
				if (new Date(lease.expiresAt).getTime() >= now) {
					active.push(lease);
				}
			} catch {
				// Corrupt — remove
				try {
					unlinkSync(path);
				} catch {
					/* ignore */
				}
			}
		}

		return active;
	}

	// ─── internals ───────────────────────────────────────────────────────────

	private _leasePath(taskId: string): string {
		return join(this.leasesDir, `${taskId}.lease.json`);
	}

	private _writeLease(lease: TaskLease): void {
		this.ensureDir();
		const tmp = `${this._leasePath(lease.taskId)}.tmp`;
		writeFileSync(tmp, JSON.stringify(lease), "utf8");
		renameSync(tmp, this._leasePath(lease.taskId));
	}

	private _removeLease(taskId: string): void {
		const path = this._leasePath(taskId);
		if (existsSync(path)) unlinkSync(path);
	}
}
