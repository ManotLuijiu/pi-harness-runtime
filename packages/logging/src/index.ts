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
export type {
	FlushStats,
	LogBatch,
	LogErrorInfo,
	LogInput,
	LogLevel,
	LogRecord,
	LogTransport,
} from "./types.js";

// --- Redaction -------------------------------------------------------------

export {
	isSecretKey,
	isSensitiveValueKey,
	redactFields,
	redactText,
	redactValue,
	splitKeyTokens,
} from "./redact.js";
export type { JsonValue, RedactionOptions } from "./redact.js";

// --- Sampling --------------------------------------------------------------

export { DEFAULT_SAMPLING_POLICY, LogSampler } from "./sampler.js";
export type { SamplingPolicy } from "./sampler.js";

// --- Buffering -------------------------------------------------------------

export { LogBuffer } from "./buffer.js";
export type { LogBufferOptions } from "./buffer.js";

// --- Local spool -----------------------------------------------------------

export { LogSpool } from "./spool.js";
export type { LogSpoolOptions } from "./spool.js";

// --- Transports ------------------------------------------------------------

export { createR2Transport, r2ObjectKey } from "./transports/r2.js";
export type { R2TransportOptions } from "./transports/r2.js";
export { createWebhookTransport } from "./transports/webhook.js";
export type { WebhookTransportOptions } from "./transports/webhook.js";

// --- Shipper ---------------------------------------------------------------

export { LogShipper } from "./shipper.js";
export type { LogShipperOptions } from "./shipper.js";

// --- Process wide singleton -------------------------------------------------

export {
	centralDebug,
	centralError,
	centralInfo,
	centralLog,
	centralWarn,
	getCentralLogConfig,
	getCentralShipper,
	initCentralLogging,
	shutdownCentralLogging,
} from "./singleton.js";
export type { InitCentralLoggingOptions } from "./singleton.js";

// --- Installation identity --------------------------------------------------

export {
	INSTALLATION_ID_FILE,
	defaultInstallationIdPath,
	isValidInstallationId,
	resolveInstallationId,
} from "./installation.js";
export type { ResolveInstallationIdOptions } from "./installation.js";

// --- Classification (what may leave the machine) ----------------------------

export {
	DEFAULT_CLASSIFICATION_POLICY,
	DEFAULT_LOCAL_EVENTS,
	DEFAULT_REMOTE_EVENTS,
	classifyRecord,
	filterRemoteRecords,
	isSanitizedMessage,
	prepareRemoteRecord,
} from "./classification.js";
export type { ClassificationPolicy } from "./classification.js";

export { LOCAL_ONLY_FIELD_KEYS, isLocalOnlyFieldKey } from "./sensitive-keys.js";

// --- Ingest contract (shared by client and server) -------------------------

export {
	DEFAULT_BATCH_LIMITS,
	LOG_LEVELS,
	sanitizeRecord,
	validateBatch,
} from "./ingest/schema.js";
export type {
	BatchValidationError,
	BatchValidationLimits,
	BatchValidationResult,
	SanitizeRecordResult,
} from "./ingest/schema.js";

// --- Server side ------------------------------------------------------------

export * from "./server/index.js";

// --- Configuration ---------------------------------------------------------

export {
	defaultKeysDir,
	defaultSpoolDir,
	resolveLogSinkConfig,
} from "./config.js";
export type { LogSinkConfig, LogSinkMode, ResolveConfigOptions } from "./config.js";
