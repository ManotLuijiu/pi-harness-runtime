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

export class LogOutboxWorker {
	private readonly outbox: LogOutbox;
	private readonly upload: (entry: OutboxEntry) => Promise<void>;
	private readonly intervalMs: number;
	private readonly maxAttempts: number;
	private readonly baseDelayMs: number;
	private readonly maxDelayMs: number;
	private readonly batchLimit: number;
	private readonly now: () => number;
	private timer: ReturnType<typeof setInterval> | undefined;
	private running = false;

	constructor(options: LogOutboxWorkerOptions) {
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
	backoffMs(attempts: number): number {
		const factor = 2 ** Math.max(0, attempts - 1);
		return Math.min(this.baseDelayMs * factor, this.maxDelayMs);
	}

	/** Start the periodic drain. */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			void this.runOnce();
		}, this.intervalMs);
		this.timer.unref?.();
	}

	/** Stop the periodic drain and wait for a running pass. */
	async stop(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		while (this.running) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	/** Drain the queue once. Never throws. */
	async runOnce(): Promise<WorkerRunResult> {
		if (this.running) return { uploaded: 0, failed: 0, skipped: 0 };
		this.running = true;
		const result: WorkerRunResult = { uploaded: 0, failed: 0, skipped: 0 };

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
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					const attempts = entry.attempts + 1;
					this.outbox.markFailed(entry, message, this.now() + this.backoffMs(attempts));
					result.failed++;
				}
			}
		} catch {
			// A failing drain must not kill the worker.
		} finally {
			this.running = false;
		}

		return result;
	}
}
