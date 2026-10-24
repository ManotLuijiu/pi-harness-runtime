/**
 * @pi-harness/logging - centralized application logging.
 *
 * One structured record format, one redaction policy, one delivery path:
 *
 *   producer -> redactor -> sampler -> buffer -> R2 / webhook -> local spool
 *
 * The transport order is deliberate: R2 keeps the durable archive, the
 * webhook server provides the live path, and the local spool is the
 * fallback that keeps data when both are unavailable.
 */
// --- Types -----------------------------------------------------------------
export { LOG_LEVEL_SEVERITY, LOG_SCHEMA_VERSION } from "./types.js";
// --- Redaction -------------------------------------------------------------
export { isSecretKey, isSensitiveValueKey, redactFields, redactText, redactValue, splitKeyTokens, } from "./redact.js";
// --- Sampling --------------------------------------------------------------
export { DEFAULT_SAMPLING_POLICY, LogSampler } from "./sampler.js";
// --- Buffering -------------------------------------------------------------
export { LogBuffer } from "./buffer.js";
// --- Local spool -----------------------------------------------------------
export { LogSpool } from "./spool.js";
// --- Transports ------------------------------------------------------------
export { createR2Transport, r2ObjectKey } from "./transports/r2.js";
export { createWebhookTransport } from "./transports/webhook.js";
// --- Shipper ---------------------------------------------------------------
export { LogShipper } from "./shipper.js";
// --- Process wide singleton -------------------------------------------------
export { centralDebug, centralError, centralInfo, centralLog, centralWarn, getCentralLogConfig, getCentralShipper, initCentralLogging, shutdownCentralLogging, } from "./singleton.js";
// --- Installation identity --------------------------------------------------
export { INSTALLATION_ID_FILE, defaultInstallationIdPath, isValidInstallationId, resolveInstallationId, } from "./installation.js";
// --- Classification (what may leave the machine) ----------------------------
export { DEFAULT_CLASSIFICATION_POLICY, DEFAULT_LOCAL_EVENTS, DEFAULT_REMOTE_EVENTS, classifyRecord, filterRemoteRecords, isSanitizedMessage, prepareRemoteRecord, } from "./classification.js";
export { LOCAL_ONLY_FIELD_KEYS, isLocalOnlyFieldKey } from "./sensitive-keys.js";
// --- Ingest contract (shared by client and server) -------------------------
export { DEFAULT_BATCH_LIMITS, LOG_LEVELS, sanitizeRecord, validateBatch, } from "./ingest/schema.js";
// --- Server side ------------------------------------------------------------
export * from "./server/index.js";
// --- Incidents (versioned, tenant scoped) -----------------------------------
export { INCIDENT_COLLECTION, INCIDENT_SCHEMA_VERSION, extractIncidents, incidentFingerprint, isKnownIncidentSchema, mergeIncident, normalizeForFingerprint, } from "./incidents/schema.js";
// --- Configuration ---------------------------------------------------------
export { defaultKeysDir, defaultSpoolDir, resolveLogSinkConfig, } from "./config.js";
//# sourceMappingURL=index.js.map