/**
 * Retry worker for the server-side outbox.
 *
 * The worker drains the queue in the background, so an R2 outage never
 * blocks the ingest endpoint: the batch waits in the queue and is retried
 * with a bounded exponential backoff.
 *
 * A batch that exhausts its attempts stays in the queue (visible in the
 * diagnostics) instead of being dropped silently.
 */
import type { LogOutbox, OutboxEntry } from "./outbox.js";
export interface LogOutboxWorkerOptions {
    outbox: LogOutbox;
    /** Uploads one batch. Throwing marks the batch as failed. */
    upload: (entry: OutboxEntry) => Promise<void>;
    /** Interval between two drain runs. Default 5000 ms. */
    intervalMs?: number;
    /** Attempts before a batch is parked. Default 10. */
    maxAttempts?: number;
    /** First backoff step. Default 5000 ms. */
    baseDelayMs?: number;
    /** Upper bound of the backoff. Default 300000 ms (5 minutes). */
    maxDelayMs?: number;
    /** Batches per run. Default 50. */
    batchLimit?: number;
    /** Clock injection (tests). */
    now?: () => number;
}
export interface WorkerRunResult {
    uploaded: number;
    failed: number;
    skipped: number;
}
export declare class LogOutboxWorker {
    private readonly outbox;
    private readonly upload;
    private readonly intervalMs;
    private readonly maxAttempts;
    private readonly baseDelayMs;
    private readonly maxDelayMs;
    private readonly batchLimit;
    private readonly now;
    private timer;
    private running;
    constructor(options: LogOutboxWorkerOptions);
    /** Backoff for the given attempt count (1 = first failure). */
    backoffMs(attempts: number): number;
    /** Start the periodic drain. */
    start(): void;
    /** Stop the periodic drain and wait for a running pass. */
    stop(): Promise<void>;
    /** Drain the queue once. Never throws. */
    runOnce(): Promise<WorkerRunResult>;
}
//# sourceMappingURL=outbox-worker.d.ts.map