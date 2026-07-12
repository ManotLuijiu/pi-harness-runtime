/**
 * Observability Package
 *
 * A comprehensive observability system with structured logging,
 * distributed tracing, metrics collection, health monitoring, and alerting.
 */
// ─── Logger ────────────────────────────────────────────────────────────────
export { Logger, createLogger, defaultLogger } from "./logger.js";
// ─── Tracer ────────────────────────────────────────────────────────────────
export { Tracer, createTracer, SpanHandle } from "./tracer.js";
// ─── Metrics ────────────────────────────────────────────────────────────────
export { Metrics, createMetrics, createBuiltInMetrics, Timer, } from "./metrics.js";
// ─── Health ────────────────────────────────────────────────────────────────
export { HealthMonitor, createHealthMonitor, createConnectivityHealthCheck, createMemoryHealthCheck, createDiskSpaceHealthCheck, } from "./health.js";
// ─── Alerts ────────────────────────────────────────────────────────────────
export { AlertEngine, createAlertEngine } from "./alerts.js";
// ─── Re-exports ────────────────────────────────────────────────────────────
export { SDK_VERSION } from "./types.js";
//# sourceMappingURL=index.js.map