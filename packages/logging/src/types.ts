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

/** Severity order used by the sampler and the buffer drop policy. */
export const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

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
	batchId: string;
	app: string;
	host: string;
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
	/** Transport errors, keyed by transport name. */
	errors: Record<string, string>;
}
