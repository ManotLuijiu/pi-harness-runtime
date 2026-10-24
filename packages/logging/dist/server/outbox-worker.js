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
export class LogOutboxWorker {
    outbox;
    upload;
    intervalMs;
    maxAttempts;
    baseDelayMs;
    maxDelayMs;
    batchLimit;
    now;
    timer;
    running = false;
    constructor(options) {
        this.outbox = options.outbox;
        this.upload = options.upload;
        this.intervalMs = options.intervalMs ?? 5_000;
        this.maxAttempts = options.maxAttempts ?? 10;
        this.baseDelayMs = options.baseDelayMs ?? 5_000;
        this.maxDelayMs = options.maxDelayMs ?? 300_000;
        this.batchLimit = options.batchLimit ?? 50;
        this.now = options.now ?? (() => Date.now());
    }
    /** Backoff for the given attempt count (1 = first failure). */
    backoffMs(attempts) {
        const factor = 2 ** Math.max(0, attempts - 1);
        return Math.min(this.baseDelayMs * factor, this.maxDelayMs);
    }
    /** Start the periodic drain. */
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            void this.runOnce();
        }, this.intervalMs);
        this.timer.unref?.();
    }
    /** Stop the periodic drain and wait for a running pass. */
    async stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        while (this.running) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    /** Drain the queue once. Never throws. */
    async runOnce() {
        if (this.running)
            return { uploaded: 0, failed: 0, skipped: 0 };
        this.running = true;
        const result = { uploaded: 0, failed: 0, skipped: 0 };
        try {
            const now = this.now();
            for (const entry of this.outbox.listPending(this.batchLimit)) {
                if (entry.nextAttemptAt > now) {
                    result.skipped++;
                    continue;
                }
                if (entry.attempts >= this.maxAttempts) {
                    result.skipped++;
                    continue;
                }
                try {
                    await this.upload(entry);
                    this.outbox.markUploaded(entry);
                    result.uploaded++;
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const attempts = entry.attempts + 1;
                    this.outbox.markFailed(entry, message, this.now() + this.backoffMs(attempts));
                    result.failed++;
                }
            }
        }
        catch {
            // A failing drain must not kill the worker.
        }
        finally {
            this.running = false;
        }
        return result;
    }
}
//# sourceMappingURL=outbox-worker.js.map