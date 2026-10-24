/**
 * The shipper owns the delivery decision.
 *
 * Producers call `log()`. The shipper redacts, samples, buffers, and then
 * delivers a batch through the configured transports.
 *
 * Two delivery modes exist:
 *
 *   fallback (the default) - the transports form a chain. The first
 *     transport that accepts the batch wins and the later ones are not
 *     called:
 *
 *       R2 (durable archive) -> webhook (live) -> local spool
 *
 *   fanout (explicit opt-in) - the transports are independent. Every
 *     transport receives the batch, each one tracks its own success, and
 *     the batch is spooled only when EVERY transport failed:
 *
 *       R2 (durable archive) + webhook (live) -> local spool
 *
 * Fallback is the default because it avoids duplicate records in the
 * archive. Fanout is opt-in because it deliberately creates a second copy
 * of every batch.
 *
 * If every transport fails the batch is spooled to disk and retried on the
 * next flush, so a temporary outage costs latency, not data.
 */
import { type LogBufferOptions } from "./buffer.js";
import { type ClassificationPolicy } from "./classification.js";
import { type RedactionOptions } from "./redact.js";
import { type SamplingPolicy } from "./sampler.js";
import { LogSpool } from "./spool.js";
import { type FlushStats, type LogInput, type LogLevel, type LogTransport } from "./types.js";
/**
 * How the batch is handed to the transports.
 *
 * - `fallback`: the first transport that accepts the batch wins.
 * - `fanout`: every transport receives the batch independently.
 */
export type DeliveryMode = "fallback" | "fanout";
/** The delivery state of one transport. */
export interface TransportStatus {
    /** The name of the transport. */
    name: string;
    /** How many batches this transport accepted. */
    delivered: number;
    /** How many batches this transport rejected. */
    failed: number;
    /** The message of the last failure. */
    lastError?: string;
    /** ISO timestamp of the last successful delivery. */
    lastSuccessAt?: string;
}
export interface LogShipperOptions {
    /** Application name reported with every batch. */
    app?: string;
    /** Version of the emitting application. */
    appVersion?: string;
    /** Stable id of this installation. */
    installationId?: string;
    /**
     * Optional display label for the machine (never an identity).
     * Defaults to the hostname, which is display metadata only.
     */
    hostLabel?: string;
    /** Opaque session id attached to the batch when the records agree. */
    sessionId?: string;
    /** Transports in priority order. */
    transports?: LogTransport[];
    /**
     * How the transports are used. `fallback` (the default) lets the first
     * transport that accepts the batch win; `fanout` delivers the batch to
     * every transport independently.
     */
    delivery?: DeliveryMode;
    /** Local spool used when every transport fails. */
    spool?: LogSpool;
    /** Buffer bounds. */
    buffer?: LogBufferOptions;
    /** Sampling policy. */
    sampling?: Partial<SamplingPolicy>;
    /** Redaction limits. */
    redaction?: RedactionOptions;
    /** What may leave the machine. */
    classification?: ClassificationPolicy;
    /** Interval for the automatic flush timer. Default 15000 ms. */
    flushIntervalMs?: number;
    /** Clock injection (tests). */
    now?: () => number;
    /** Batch id factory (tests). */
    createBatchId?: () => string;
}
export declare class LogShipper {
    private readonly app;
    private readonly appVersion;
    private readonly installationId;
    private readonly hostLabel;
    private readonly sessionId;
    private readonly transports;
    private readonly delivery;
    private readonly transportStatus;
    private readonly spool;
    private readonly buffer;
    private readonly sampler;
    private readonly redaction;
    private readonly classification;
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
    /**
     * The delivery state of every transport.
     *
     * In fanout mode this is the only way to see that one transport is
     * broken while the others still deliver.
     */
    getTransportStatus(): TransportStatus[];
    /** The delivery mode of the shipper. */
    get deliveryMode(): DeliveryMode;
    private buildRecord;
    private buildBatch;
    private doFlush;
    /**
     * Deliver the batch to the transports.
     *
     * In `fallback` mode the transports form a chain: the first one that
     * accepts the batch wins and the later ones are not called.
     *
     * In `fanout` mode every transport receives the batch independently.
     * Each transport tracks its own success, so a broken transport does not
     * hide the success of the others. The batch is only lost when EVERY
     * transport failed.
     */
    private deliver;
    /** Deliver the batch to every transport. Returns true when one accepted it. */
    private deliverToAll;
    /** Record a successful delivery. */
    private noteSuccess;
    /** Record a failed delivery. */
    private noteFailure;
    /** The delivery state of one transport. */
    private statusFor;
    /** Re-send spooled files. Stops at the first failure. */
    private drainSpool;
}
export type { LogLevel };
//# sourceMappingURL=shipper.d.ts.map