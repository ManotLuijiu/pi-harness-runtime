/**
 * Log Sink - shared types for the centralized logging pipeline.
 *
 * The pipeline has three layers:
 *   1. `LogRecord` - the structured, redacted unit that every producer emits.
 *   2. `LogBatch`  - the transport unit (NDJSON over R2 or HTTP to the webhook).
 *   3. `LogTransport` - the pluggable delivery mechanism.
 *
 * Producers never know which transport is configured; the shipper owns that
 * decision, including the fallback order and the local spool.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
/**
 * Schema version of the batch/record contract.
 *
 * v2 adds the installation identity (`installationId`), the app version and
 * a `schemaVersion` marker, so a server can tell an old client from a new
 * one instead of guessing.
 */
export declare const LOG_SCHEMA_VERSION = 2;
/** Severity order used by the sampler and the buffer drop policy. */
export declare const LOG_LEVEL_SEVERITY: Record<LogLevel, number>;
export interface LogErrorInfo {
    name: string;
    message: string;
    stack?: string;
}
/** A single structured log record. */
export interface LogRecord {
    /** ISO-8601 timestamp of the event. */
    ts: string;
    level: LogLevel;
    /** Emitting component, e.g. "jev-judge" or "harness.service-diagnostics". */
    source: string;
    /** Dotted event name, e.g. "service.config_checked". */
    event: string;
    message?: string;
    sessionId?: string;
    durationMs?: number;
    /** Structured, already redacted payload. */
    fields?: Record<string, unknown>;
    error?: LogErrorInfo;
}
/** What a producer hands to the shipper. */
export interface LogInput {
    level: LogLevel;
    source: string;
    event: string;
    message?: string;
    sessionId?: string;
    durationMs?: number;
    fields?: Record<string, unknown>;
    /** Anything thrown - converted to a `LogErrorInfo` by the shipper. */
    error?: unknown;
}
/** The transport unit: a batch of records shipped together. */
export interface LogBatch {
    /** Contract version, see `LOG_SCHEMA_VERSION`. */
    schemaVersion: number;
    batchId: string;
    /** Application name, e.g. "pi-harness". */
    app: string;
    /** Version of the emitting application. */
    appVersion?: string;
    /**
     * Stable random id of this installation, created once per local install.
     *
     * It is the only machine identity in the protocol. It is never derived
     * from the hostname and it is not an identity on the server either - the
     * tenant comes from the authenticated credential.
     */
    installationId: string;
    /** Optional user-editable display label (never an identity). */
    hostLabel?: string;
    /** Opaque session id, when the producer knows one. */
    sessionId?: string;
    /** ISO-8601 timestamp of the send. */
    sentAt: string;
    records: LogRecord[];
}
/** A delivery mechanism. Throwing means "delivery failed". */
export interface LogTransport {
    readonly name: string;
    send(batch: LogBatch): Promise<void>;
}
export interface FlushStats {
    /** Records handed to a transport successfully. */
    shipped: number;
    /** Records written to the local spool after every transport failed. */
    spooled: number;
    /** Records dropped by the buffer because it was full. */
    dropped: number;
    /** Records dropped by the sampler (level, sample rate, rate limit). */
    sampled: number;
    /** Records that stayed on the machine (classification: local only). */
    localOnly: number;
    /** Transport errors, keyed by transport name. */
    errors: Record<string, string>;
}
//# sourceMappingURL=types.d.ts.map