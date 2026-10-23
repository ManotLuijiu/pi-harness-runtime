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
import { type LogBufferOptions } from "./buffer.js";
import { type RedactionOptions } from "./redact.js";
import { type SamplingPolicy } from "./sampler.js";
import { LogSpool } from "./spool.js";
import type { FlushStats, LogInput, LogLevel, LogTransport } from "./types.js";
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
export declare class LogShipper {
    private readonly app;
    private readonly host;
    private readonly transports;
    private readonly spool;
    private readonly buffer;
    private readonly sampler;
    private readonly redaction;
    private readonly flushIntervalMs;
    private readonly now;
    private readonly createBatchId;
    private timer;
    private flushing;
    private stats;
    constructor(options?: LogShipperOptions);
    /** Record a log event. Never throws. */
    log(input: LogInput): void;
    /** Convenience wrappers around `log()`. */
    debug(source: string, event: string, message?: string, fields?: Record<string, unknown>): void;
    info(source: string, event: string, message?: string, fields?: Record<string, unknown>): void;
    warn(source: string, event: string, message?: string, fields?: Record<string, unknown>): void;
    error(source: string, event: string, message?: string, fields?: Record<string, unknown>, error?: unknown): void;
    /** Deliver buffered records (and drain the spool). Never throws. */
    flush(): Promise<void>;
    /**
     * Synchronous last resort used on process exit: whatever is still in
     * memory is written to the local spool so it is not lost.
     */
    flushSync(): void;
    /** Start the periodic flush timer. */
    start(): void;
    /** Stop the timer and flush once more. */
    stop(): Promise<void>;
    getStats(): FlushStats;
    private buildRecord;
    private buildBatch;
    private doFlush;
    /** Try every transport in order. Returns true when one accepted the batch. */
    private deliver;
    /** Re-send spooled files. Stops at the first failure. */
    private drainSpool;
}
export type { LogLevel };
//# sourceMappingURL=shipper.d.ts.map