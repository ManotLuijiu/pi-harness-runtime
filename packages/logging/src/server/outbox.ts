/**
 * Durable server-side outbox.
 *
 * The ingest endpoint must not tell a client "accepted" before the batch
 * survived a crash. The outbox is the durable hand-off point between the
 * HTTP request and the R2 upload:
 *
 *   request -> validate -> enqueue (durable) -> 202
 *                                         |
 *                                         v
 *                               worker -> upload -> done
 *
 * The queue is a directory of JSON files, one per accepted batch:
 *
 *   <dir>/pending/<key>.json        the batch payload
 *   <dir>/pending/<key>.meta.json   attempts, next attempt, last error
 *   <dir>/done/<key>.json           uploaded batches (pruned after a while)
 *
 * A plain file queue is used on purpose: the server runs under Bun, which
 * has no `node:sqlite`, and the queue stays inspectable with `ls`/`jq`.
 *
 * The key is derived from (tenant, installation, batch), so the same batch
 * is enqueued only once - the ingest endpoint is idempotent.
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { LogRecord } from "../types.js";

export interface OutboxBatch {
	tenantId: string;
	installationId: string;
	batchId: string;
	app: string;
	appVersion?: string;
	hostLabel?: string;
	sessionId?: string;
	sentAt: string;
	records: LogRecord[];
}

export interface OutboxEntry {
	/** File name key of the batch. */
	key: string;
	/** Absolute path of the payload file. */
	path: string;
	batch: OutboxBatch;
	attempts: number;
	nextAttemptAt: number;
	lastError?: string;
	createdAt: number;
}

export interface OutboxStats {
	/** Batches waiting for an upload. */
	pending: number;
	/** Age of the oldest pending batch in milliseconds. */
	oldestPendingAgeMs: number;
	/** Batches that failed at least once. */
	failures: number;
	/** Last upload error (message only, never a payload). */
	lastError?: string;
}

export interface EnqueueResult {
	accepted: boolean;
	/** True when the same batch was already queued (idempotent replay). */
	duplicate: boolean;
}

export interface LogOutboxOptions {
	/** Directory of the queue. */
	dir: string;
	/** How long uploaded batches are kept, in milliseconds. Default 7 days. */
	retentionMs?: number;
}

/** Make a value safe to use inside a file name. */
export function safeSegment(value: string, maxLength = 48): string {
	const cleaned = value
		.replace(/\.\./g, "_")
		.replace(/[^A-Za-z0-9._-]/g, "_")
		.slice(0, maxLength)
		.replace(/^\.+/, "_");
	return cleaned.length > 0 ? cleaned : "unknown";
}

/**
 * Build the queue key of a batch.
 *
 * The key is unique per (tenant, installation, batch) and contains no
 * user controlled path segment.
 */
export function outboxKey(batch: {
	tenantId: string;
	installationId: string;
	batchId: string;
}): string {
	const digest = createHash("sha256")
		.update(`${batch.tenantId}|${batch.installationId}|${batch.batchId}`, "utf8")
		.digest("hex")
		.slice(0, 12);
	return `${safeSegment(batch.tenantId)}--${safeSegment(batch.batchId)}--${digest}`;
}

export class LogOutbox {
	private readonly dir: string;
	private readonly pendingDir: string;
	private readonly doneDir: string;
	private readonly retentionMs: number;

	constructor(options: LogOutboxOptions) {
		this.dir = options.dir;
		this.pendingDir = join(options.dir, "pending");
		this.doneDir = join(options.dir, "done");
		this.retentionMs = options.retentionMs ?? 7 * 24 * 60 * 60 * 1000;
		try {
			mkdirSync(this.pendingDir, { recursive: true });
			mkdirSync(this.doneDir, { recursive: true });
		} catch {
			// The enqueue call reports the failure with a retryable error.
		}
	}

	/** Directory of the queue. */
	get directory(): string {
		return this.dir;
	}

	/**
	 * Store a batch durably.
	 *
	 * The write is atomic (write to a temp file, then rename), so a crash
	 * can never leave a half written batch behind.
	 */
	enqueue(batch: OutboxBatch): EnqueueResult {
		const key = outboxKey(batch);
		const payloadPath = join(this.pendingDir, `${key}.json`);

		if (existsSync(payloadPath) || existsSync(join(this.doneDir, `${key}.json`))) {
			return { accepted: true, duplicate: true };
		}

		const tempPath = `${payloadPath}.tmp`;
		try {
			writeFileSync(tempPath, `${JSON.stringify(batch)}\n`, { mode: 0o600 });
			renameSync(tempPath, payloadPath);
		} catch (error) {
			try {
				rmSync(tempPath, { force: true });
			} catch {
				// Nothing else to do.
			}
			throw error;
		}

		this.writeMeta(key, {
			attempts: 0,
			nextAttemptAt: Date.now(),
			createdAt: Date.now(),
		});

		return { accepted: true, duplicate: false };
	}

	/** The batches waiting for an upload, oldest first. */
	listPending(limit = 100): OutboxEntry[] {
		const entries: OutboxEntry[] = [];
		let names: string[];
		try {
			names = readdirSync(this.pendingDir);
		} catch {
			return entries;
		}

		for (const name of names) {
			if (!name.endsWith(".json") || name.endsWith(".meta.json")) continue;
			const entry = this.readEntry(join(this.pendingDir, name));
			if (entry) entries.push(entry);
		}

		entries.sort((a, b) => a.createdAt - b.createdAt);
		return entries.slice(0, limit);
	}

	/** Mark a batch as uploaded and move it out of the pending directory. */
	markUploaded(entry: OutboxEntry): void {
		try {
			renameSync(entry.path, join(this.doneDir, `${entry.key}.json`));
		} catch {
			// The file may have been moved already; nothing to do.
		}
		try {
			rmSync(join(this.pendingDir, `${entry.key}.meta.json`), { force: true });
		} catch {
			// Ignore.
		}
	}

	/**
	 * Record a failed upload and schedule the next attempt.
	 */
	markFailed(entry: OutboxEntry, error: string, nextAttemptAt: number): void {
		this.writeMeta(entry.key, {
			attempts: entry.attempts + 1,
			nextAttemptAt,
			lastError: error,
			createdAt: entry.createdAt,
		});
	}

	/** Queue depth, oldest pending age and failure information. */
	stats(now = Date.now()): OutboxStats {
		const entries = this.listPending(Number.MAX_SAFE_INTEGER);
		let oldestPendingAgeMs = 0;
		let failures = 0;
		let lastError: string | undefined;

		for (const entry of entries) {
			const age = now - entry.createdAt;
			if (oldestPendingAgeMs === 0 || age > oldestPendingAgeMs) oldestPendingAgeMs = age;
			if (entry.attempts > 0) failures++;
			if (entry.lastError) lastError = entry.lastError;
		}

		return { pending: entries.length, oldestPendingAgeMs, failures, lastError };
	}

	/** Delete uploaded batches that are older than the retention period. */
	prune(now = Date.now()): number {
		let removed = 0;
		let names: string[];
		try {
			names = readdirSync(this.doneDir);
		} catch {
			return 0;
		}
		for (const name of names) {
			const path = join(this.doneDir, name);
			try {
				const age = now - statSync(path).mtimeMs;
				if (age > this.retentionMs) {
					rmSync(path, { force: true });
					removed++;
				}
			} catch {
				// Ignore a file that vanished.
			}
		}
		return removed;
	}

	private writeMeta(
		key: string,
		meta: { attempts: number; nextAttemptAt: number; createdAt: number; lastError?: string },
	): void {
		const path = join(this.pendingDir, `${key}.meta.json`);
		const tempPath = `${path}.tmp`;
		try {
			writeFileSync(tempPath, `${JSON.stringify(meta)}\n`, { mode: 0o600 });
			renameSync(tempPath, path);
		} catch {
			// The meta file is an optimisation: without it the batch is still
			// retried, only without the backoff hint.
		}
	}

	private readEntry(path: string): OutboxEntry | null {
		const key = path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
		try {
			const batch = JSON.parse(readFileSync(path, "utf8")) as OutboxBatch;
			let meta: { attempts: number; nextAttemptAt: number; createdAt: number; lastError?: string } = {
				attempts: 0,
				nextAttemptAt: 0,
				createdAt: 0,
			};
			try {
				const metaPath = join(this.pendingDir, `${key}.meta.json`);
				if (existsSync(metaPath)) {
					meta = { ...meta, ...(JSON.parse(readFileSync(metaPath, "utf8")) as typeof meta) };
				}
			} catch {
				// Fall back to the defaults.
			}
			let createdAt = meta.createdAt;
			if (!createdAt) {
				try {
					createdAt = statSync(path).mtimeMs;
				} catch {
					createdAt = Date.now();
				}
			}
			return {
				key,
				path,
				batch,
				attempts: meta.attempts ?? 0,
				nextAttemptAt: meta.nextAttemptAt ?? 0,
				lastError: meta.lastError,
				createdAt,
			};
		} catch {
			return null;
		}
	}
}
