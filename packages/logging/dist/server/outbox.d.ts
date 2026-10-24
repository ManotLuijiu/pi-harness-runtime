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
export declare function safeSegment(value: string, maxLength?: number): string;
/**
 * Build the queue key of a batch.
 *
 * The key is unique per (tenant, installation, batch) and contains no
 * user controlled path segment.
 */
export declare function outboxKey(batch: {
    tenantId: string;
    installationId: string;
    batchId: string;
}): string;
export declare class LogOutbox {
    private readonly dir;
    private readonly pendingDir;
    private readonly doneDir;
    private readonly retentionMs;
    constructor(options: LogOutboxOptions);
    /** Directory of the queue. */
    get directory(): string;
    /**
     * Store a batch durably.
     *
     * The write is atomic (write to a temp file, then rename), so a crash
     * can never leave a half written batch behind.
     */
    enqueue(batch: OutboxBatch): EnqueueResult;
    /** The batches waiting for an upload, oldest first. */
    listPending(limit?: number): OutboxEntry[];
    /** Mark a batch as uploaded and move it out of the pending directory. */
    markUploaded(entry: OutboxEntry): void;
    /**
     * Record a failed upload and schedule the next attempt.
     */
    markFailed(entry: OutboxEntry, error: string, nextAttemptAt: number): void;
    /** Queue depth, oldest pending age and failure information. */
    stats(now?: number): OutboxStats;
    /** Delete uploaded batches that are older than the retention period. */
    prune(now?: number): number;
    private writeMeta;
    private readEntry;
}
//# sourceMappingURL=outbox.d.ts.map