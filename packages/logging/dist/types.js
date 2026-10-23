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
/** Severity order used by the sampler and the buffer drop policy. */
export const LOG_LEVEL_SEVERITY = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
//# sourceMappingURL=types.js.map