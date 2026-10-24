/**
 * Ingest contract: strict validation and allowlisted redaction.
 *
 * The client and the server share this module, so both sides agree on what a
 * batch is. The server never trusts the body:
 *
 *   - the tenant comes from the authenticated credential, never from the JSON,
 *   - the batch is validated against a strict, versioned schema,
 *   - the records are rebuilt from an allowlist, so an unknown property can
 *     never smuggle data into the archive,
 *   - every string is redacted again on the server (defence in depth).
 */
import { type LogBatch, type LogLevel, type LogRecord } from "../types.js";
export declare const LOG_LEVELS: readonly LogLevel[];
export interface BatchValidationLimits {
    /** Maximum number of records in one batch. */
    maxRecords: number;
    /** Maximum length of a single string value. */
    maxStringLength: number;
    /** Maximum number of structured fields per record. */
    maxFieldKeys: number;
}
export declare const DEFAULT_BATCH_LIMITS: BatchValidationLimits;
export interface BatchValidationError {
    code: string;
    message: string;
}
export type BatchValidationResult = {
    ok: true;
    batch: LogBatch;
    warnings: string[];
} | {
    ok: false;
    error: BatchValidationError;
};
/**
 * Validate an inbound batch.
 *
 * Unknown properties are NOT an error here - the sanitizer drops them. Only a
 * structurally broken batch is rejected.
 */
export declare function validateBatch(input: unknown, options?: {
    limits?: Partial<BatchValidationLimits>;
}): BatchValidationResult;
export type SanitizeRecordResult = {
    ok: true;
    record: LogRecord;
} | {
    ok: false;
    error: BatchValidationError;
};
/**
 * Rebuild one record from the allowlist and redact every string.
 *
 * Unknown properties are dropped, `error.name`, `error.message` and
 * `error.stack` are redacted, and structured fields lose the keys that can
 * carry private content.
 */
export declare function sanitizeRecord(input: unknown, limits?: Partial<BatchValidationLimits>): SanitizeRecordResult;
//# sourceMappingURL=schema.d.ts.map