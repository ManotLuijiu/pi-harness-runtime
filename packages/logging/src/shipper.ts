/**
 * The shipper owns the delivery decision.
 *
 * Producers call `log()`. The shipper redacts, samples, buffers, and then
 * delivers a batch through the configured transports in priority order:
 *
 *   R2 (durable archive) -> webhook (live) -> local spool (last resort)
 *
 * If every transport fails the batch is spooled to disk and retried on the
 * next flush, so a temporary outage costs latency, not data.
 */

import { hostname } from "node:os";
import { LogBuffer, type LogBufferOptions } from "./buffer.js";
import { redactFields, redactText, type RedactionOptions } from "./redact.js";
import { LogSampler, type SamplingPolicy } from "./sampler.js";
import { LogSpool } from "./spool.js";
import type { FlushStats, LogBatch, LogErrorInfo, LogInput, LogLevel, LogRecord, LogTransport } from "./types.js";

export interface LogShipperOptions {
	/** Application name reported with every batch. */
	app?: string;
	/** Host name reported with every batch. */
	host?: string;
	/** Transports in priority order. */
	transports?: LogTransport[];
	/** Local spool used when every transport fails. */
	spool?: LogSpool;
	/** Buffer bounds. */
	buffer?: LogBufferOptions;
	/** Sampling policy. */
	sampling?: Partial<SamplingPolicy>;
	/** Redaction limits. */
	redaction?: RedactionOptions;
	/** Interval for the automatic flush timer. Default 15000 ms. */
	flushIntervalMs?: number;
	/** Clock injection (tests). */
	now?: () => number;
	/** Batch id factory (tests). */
	createBatchId?: () => string;
}

function defaultBatchId(): string {
	const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
	return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function toErrorInfo(error: unknown): LogErrorInfo {
	if (error instanceof Error) {
		const info: LogErrorInfo = { name: error.name, message: error.message };
		if (error.stack) info.stack = error.stack;
		return info;
	}
	return { name: "Error", message: String(error) };
}

export class LogShipper {
	private readonly app: string;
	private readonly host: string;
	private readonly transports: LogTransport[];
	private readonly spool: LogSpool | undefined;
	private readonly buffer: LogBuffer;
	private readonly sampler: LogSampler;
	private readonly redaction: RedactionOptions;
	private readonly flushIntervalMs: number;
	private readonly now: () => number;
	private readonly createBatchId: () => string;
	private timer: ReturnType<typeof setInterval> | undefined;
	private flushing: Promise<void> | undefined;
	private stats: FlushStats = {
		shipped: 0,
		spooled: 0,
		dropped: 0,
		sampled: 0,
		errors: {},
	};

	constructor(options: LogShipperOptions = {}) {
		this.app = options.app ?? "pi-harness";
		this.host = options.host ?? hostname();
		this.transports = options.transports ?? [];
		this.spool = options.spool;
		this.buffer = new LogBuffer(options.buffer);
		this.sampler = new LogSampler(options.sampling);
		this.redaction = options.redaction ?? {};
		this.flushIntervalMs = options.flushIntervalMs ?? 15_000;
		this.now = options.now ?? (() => Date.now());
		this.createBatchId = options.createBatchId ?? defaultBatchId;
	}

	/** Record a log event. Never throws. */
	log(input: LogInput): void {
		try {
			const record = this.buildRecord(input);
			if (!this.sampler.shouldLog(record, this.now())) {
				this.stats.sampled++;
				return;
			}
			this.buffer.push(record);
			if (this.buffer.size >= this.buffer.batchSize) {
				void this.flush();
			}
		} catch {
			// A logging failure must never break the caller.
		}
	}

	/** Convenience wrappers around `log()`. */
	debug(source: string, event: string, message?: string, fields?: Record<string, unknown>): void {
		this.log({ level: "debug", source, event, message, fields });
	}

	info(source: string, event: string, message?: string, fields?: Record<string, unknown>): void {
		this.log({ level: "info", source, event, message, fields });
	}

	warn(source: string, event: string, message?: string, fields?: Record<string, unknown>): void {
		this.log({ level: "warn", source, event, message, fields });
	}

	error(
		source: string,
		event: string,
		message?: string,
		fields?: Record<string, unknown>,
		error?: unknown,
	): void {
		this.log({ level: "error", source, event, message, fields, error });
	}

	/** Deliver buffered records (and drain the spool). Never throws. */
	async flush(): Promise<void> {
		if (this.flushing) return this.flushing;
		this.flushing = this.doFlush().finally(() => {
			this.flushing = undefined;
		});
		return this.flushing;
	}

	/**
	 * Synchronous last resort used on process exit: whatever is still in
	 * memory is written to the local spool so it is not lost.
	 */
	flushSync(): void {
		try {
			const records = this.buffer.peekAll();
			if (records.length === 0) return;
			this.buffer.clear();
			if (!this.spool) return;
			this.spool.append(this.buildBatch(records));
			this.stats.spooled += records.length;
		} catch {
			// Nothing else we can do at exit time.
		}
	}

	/** Start the periodic flush timer. */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			void this.flush();
		}, this.flushIntervalMs);
		// Never keep the process alive just for log delivery.
		this.timer.unref?.();
	}

	/** Stop the timer and flush once more. */
	async stop(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		await this.flush();
	}

	getStats(): FlushStats {
		return {
			...this.stats,
			dropped: this.stats.dropped + this.buffer.dropped,
			errors: { ...this.stats.errors },
		};
	}

	private buildRecord(input: LogInput): LogRecord {
		const record: LogRecord = {
			ts: new Date(this.now()).toISOString(),
			level: input.level,
			source: input.source,
			event: input.event,
		};

		if (input.message !== undefined) {
			record.message = redactText(input.message, this.redaction.placeholder);
		}
		if (input.sessionId) record.sessionId = input.sessionId;
		if (typeof input.durationMs === "number") record.durationMs = input.durationMs;

		const fields = redactFields(input.fields, this.redaction);
		if (fields && Object.keys(fields).length > 0) record.fields = fields;

		if (input.error !== undefined) {
			const info = toErrorInfo(input.error);
			record.error = {
				name: info.name,
				message: redactText(info.message, this.redaction.placeholder),
				...(info.stack ? { stack: redactText(info.stack, this.redaction.placeholder) } : {}),
			};
		}

		return record;
	}

	private buildBatch(records: LogRecord[]): LogBatch {
		return {
			batchId: this.createBatchId(),
			app: this.app,
			host: this.host,
			sentAt: new Date(this.now()).toISOString(),
			records,
		};
	}

	private async doFlush(): Promise<void> {
		try {
			await this.drainSpool();

			const records = this.buffer.takeBatch();
			if (records.length === 0) return;

			const batch = this.buildBatch(records);
			const delivered = await this.deliver(batch);
			if (delivered) {
				this.stats.shipped += records.length;
				return;
			}

			if (this.spool) {
				this.spool.append(batch);
				this.stats.spooled += records.length;
			} else {
				this.stats.dropped += records.length;
			}
		} catch {
			// Never let a flush failure escape.
		}
	}

	/** Try every transport in order. Returns true when one accepted the batch. */
	private async deliver(batch: LogBatch): Promise<boolean> {
		for (const transport of this.transports) {
			try {
				await transport.send(batch);
				return true;
			} catch (error) {
				this.stats.errors[transport.name] =
					error instanceof Error ? error.message : String(error);
			}
		}
		return false;
	}

	/** Re-send spooled files. Stops at the first failure. */
	private async drainSpool(): Promise<void> {
		if (!this.spool) return;
		const files = this.spool.list();
		for (const file of files) {
			const records = this.spool.read(file);
			if (records.length === 0) {
				this.spool.remove(file);
				continue;
			}
			const batch = this.buildBatch(records);
			const delivered = await this.deliver(batch);
			if (!delivered) return;
			this.spool.remove(file);
			this.stats.shipped += records.length;
		}
	}
}

export type { LogLevel };
