/**
 * Observability Package
 *
 * A comprehensive observability system with structured logging,
 * distributed tracing, metrics collection, health monitoring, and alerting.
 */

// ─── Logger ────────────────────────────────────────────────────────────────

export { Logger, createLogger, defaultLogger } from "./logger.js";
export type {
	LoggerConfig,
	LogEntry,
	LogFormat,
	LogLevel,
	LogOutput,
} from "./types.js";

// ─── Tracer ────────────────────────────────────────────────────────────────

export { Tracer, createTracer, SpanHandle } from "./tracer.js";
export type {
	Span,
	SpanEvent,
	SpanStatus,
	SpanLink,
	StartSpanOptions,
	TracerConfig,
} from "./types.js";

// ─── Metrics ────────────────────────────────────────────────────────────────

export {
	Metrics,
	createMetrics,
	createBuiltInMetrics,
	Timer,
} from "./metrics.js";
export type {
	Counter,
	Gauge,
	Histogram,
	HistogramBucket,
	Labels,
	MetricsConfig,
	PrometheusMetric,
	Summary,
} from "./types.js";

// ─── Health ────────────────────────────────────────────────────────────────

export {
	HealthMonitor,
	createHealthMonitor,
	createConnectivityHealthCheck,
	createMemoryHealthCheck,
	createDiskSpaceHealthCheck,
} from "./health.js";
export type {
	HealthCheck,
	HealthCheckRegistration,
	HealthReport,
	HealthResult,
} from "./types.js";

// ─── Alerts ────────────────────────────────────────────────────────────────

export { AlertEngine, createAlertEngine } from "./alerts.js";
export type {
	Alert,
	AlertAction,
	AlertCondition,
	AlertRule,
	AlertSeverity,
} from "./types.js";

// ─── Re-exports ────────────────────────────────────────────────────────────

export { SDK_VERSION } from "./types.js";
