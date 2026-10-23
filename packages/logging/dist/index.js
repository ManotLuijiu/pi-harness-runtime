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
export { LOG_LEVEL_SEVERITY } from "./types.js";
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
// --- Configuration ---------------------------------------------------------
export { defaultKeysDir, defaultSpoolDir, resolveLogSinkConfig, } from "./config.js";
//# sourceMappingURL=index.js.map