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
import { redactText, redactValue } from "../redact.js";
import { isLocalOnlyFieldKey } from "../sensitive-keys.js";
import { LOG_SCHEMA_VERSION } from "../types.js";
export const LOG_LEVELS = ["debug", "info", "warn", "error"];
export const DEFAULT_BATCH_LIMITS = {
    maxRecords: 1000,
    maxStringLength: 8192,
    maxFieldKeys: 64,
};
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isIsoTimestamp(value) {
    return Number.isFinite(Date.parse(value));
}
/** Batch ids are opaque but must stay safe to use in an object key. */
const BATCH_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;
/**
 * Validate an inbound batch.
 *
 * Unknown properties are NOT an error here - the sanitizer drops them. Only a
 * structurally broken batch is rejected.
 */
export function validateBatch(input, options = {}) {
    const limits = { ...DEFAULT_BATCH_LIMITS, ...options.limits };
    const warnings = [];
    if (!isPlainObject(input)) {
        return { ok: false, error: { code: "invalid_batch", message: "batch must be an object" } };
    }
    let schemaVersion = input.schemaVersion;
    if (schemaVersion === undefined) {
        // A client that predates the version marker sends v1.
        schemaVersion = 1;
        warnings.push("batch without a schema version, treated as legacy v1");
    }
    if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) {
        return {
            ok: false,
            error: { code: "invalid_schema_version", message: "schemaVersion must be a number" },
        };
    }
    if (schemaVersion < 1) {
        return {
            ok: false,
            error: { code: "invalid_schema_version", message: "schemaVersion must be >= 1" },
        };
    }
    if (schemaVersion > LOG_SCHEMA_VERSION) {
        return {
            ok: false,
            error: {
                code: "unsupported_schema_version",
                message: `schemaVersion ${schemaVersion} is newer than the supported version ${LOG_SCHEMA_VERSION}`,
            },
        };
    }
    if (schemaVersion < LOG_SCHEMA_VERSION) {
        warnings.push(`legacy schemaVersion ${schemaVersion}`);
    }
    const batchId = input.batchId;
    if (typeof batchId !== "string" || !BATCH_ID_PATTERN.test(batchId)) {
        return {
            ok: false,
            error: { code: "invalid_batch_id", message: "batchId is missing or malformed" },
        };
    }
    const app = input.app;
    if (typeof app !== "string" || app.length === 0 || app.length > 64) {
        return { ok: false, error: { code: "invalid_app", message: "app is missing or malformed" } };
    }
    const installationId = input.installationId;
    if (installationId !== undefined && typeof installationId !== "string") {
        return {
            ok: false,
            error: { code: "invalid_installation_id", message: "installationId must be a string" },
        };
    }
    if (schemaVersion >= 2) {
        if (typeof installationId !== "string" || !INSTALLATION_ID_PATTERN.test(installationId)) {
            return {
                ok: false,
                error: { code: "invalid_installation_id", message: "installationId is missing or malformed" },
            };
        }
    }
    else if (!installationId) {
        warnings.push("batch without an installation id");
    }
    const sentAt = input.sentAt;
    if (typeof sentAt !== "string" || !isIsoTimestamp(sentAt)) {
        return { ok: false, error: { code: "invalid_sent_at", message: "sentAt is not a timestamp" } };
    }
    const records = input.records;
    if (!Array.isArray(records)) {
        return { ok: false, error: { code: "invalid_records", message: "records must be an array" } };
    }
    if (records.length === 0) {
        return { ok: false, error: { code: "empty_batch", message: "records must not be empty" } };
    }
    if (records.length > limits.maxRecords) {
        return {
            ok: false,
            error: {
                code: "too_many_records",
                message: `records exceed the limit of ${limits.maxRecords}`,
            },
        };
    }
    const sanitized = [];
    for (const record of records) {
        const result = sanitizeRecord(record, limits);
        if (!result.ok) {
            return { ok: false, error: result.error };
        }
        sanitized.push(result.record);
    }
    const batch = {
        schemaVersion,
        batchId,
        app,
        installationId: typeof installationId === "string" ? installationId : "legacy",
        sentAt,
        records: sanitized,
    };
    if (typeof input.appVersion === "string")
        batch.appVersion = input.appVersion.slice(0, 32);
    if (typeof input.hostLabel === "string")
        batch.hostLabel = input.hostLabel.slice(0, 128);
    if (typeof input.sessionId === "string")
        batch.sessionId = input.sessionId.slice(0, 128);
    return { ok: true, batch, warnings };
}
/** Record keys that are accepted. Everything else is dropped. */
const ALLOWED_RECORD_KEYS = new Set([
    "ts",
    "level",
    "source",
    "event",
    "message",
    "sessionId",
    "durationMs",
    "fields",
    "error",
]);
/**
 * Copy only the allowed properties of a record.
 *
 * This is the allowlist in action: a property the contract does not know is
 * dropped before anything else happens to the record.
 */
function pickAllowedProperties(input) {
    const picked = {};
    for (const key of ALLOWED_RECORD_KEYS) {
        if (key in input)
            picked[key] = input[key];
    }
    return picked;
}
/**
 * Rebuild one record from the allowlist and redact every string.
 *
 * Unknown properties are dropped, `error.name`, `error.message` and
 * `error.stack` are redacted, and structured fields lose the keys that can
 * carry private content.
 */
export function sanitizeRecord(input, limits = {}) {
    const merged = { ...DEFAULT_BATCH_LIMITS, ...limits };
    if (!isPlainObject(input)) {
        return { ok: false, error: { code: "invalid_record", message: "record must be an object" } };
    }
    const allowed = pickAllowedProperties(input);
    const ts = allowed.ts;
    if (typeof ts !== "string" || !isIsoTimestamp(ts)) {
        return { ok: false, error: { code: "invalid_ts", message: "ts is not a timestamp" } };
    }
    const level = allowed.level;
    if (typeof level !== "string" || !LOG_LEVELS.includes(level)) {
        return { ok: false, error: { code: "invalid_level", message: "level is not known" } };
    }
    const source = allowed.source;
    if (typeof source !== "string" || source.length === 0 || source.length > 128) {
        return { ok: false, error: { code: "invalid_source", message: "source is missing or malformed" } };
    }
    const event = allowed.event;
    if (typeof event !== "string" || event.length === 0 || event.length > 128) {
        return { ok: false, error: { code: "invalid_event", message: "event is missing or malformed" } };
    }
    const record = {
        ts,
        level: level,
        source,
        event,
    };
    if (typeof allowed.message === "string") {
        record.message = redactText(allowed.message).slice(0, merged.maxStringLength);
    }
    if (typeof allowed.sessionId === "string") {
        record.sessionId = allowed.sessionId.slice(0, 128);
    }
    if (typeof allowed.durationMs === "number" && Number.isFinite(allowed.durationMs)) {
        record.durationMs = allowed.durationMs;
    }
    if (isPlainObject(allowed.fields)) {
        const fields = {};
        let kept = 0;
        for (const [key, value] of Object.entries(allowed.fields)) {
            if (kept >= merged.maxFieldKeys)
                break;
            if (isLocalOnlyFieldKey(key))
                continue;
            fields[key] = redactValue(value);
            kept++;
        }
        if (Object.keys(fields).length > 0)
            record.fields = fields;
    }
    if (isPlainObject(allowed.error)) {
        const error = { name: "Error", message: "" };
        if (typeof allowed.error.name === "string") {
            error.name = redactText(allowed.error.name).slice(0, 256);
        }
        if (typeof allowed.error.message === "string") {
            error.message = redactText(allowed.error.message).slice(0, merged.maxStringLength);
        }
        if (typeof allowed.error.stack === "string") {
            error.stack = redactText(allowed.error.stack).slice(0, merged.maxStringLength);
        }
        record.error = error;
    }
    return { ok: true, record };
}
//# sourceMappingURL=schema.js.map