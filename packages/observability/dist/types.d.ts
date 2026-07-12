/**
 * Observability Package - Types
 *
 * Core types for logging, tracing, metrics, and health monitoring.
 */
/**
 * SDK version for compatibility checks
 */
export declare const SDK_VERSION = "1.0.0";
/**
 * Log severity levels
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
/**
 * Log output format
 */
export type LogFormat = "json" | "pretty";
/**
 * Log output destination
 */
export type LogOutput = "stdout" | "stderr" | "file" | "both";
/**
 * Log entry structure
 */
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;
    jobId?: string;
    taskId?: string;
    component?: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
}
/**
 * Logger configuration
 */
export interface LoggerConfig {
    level?: LogLevel;
    format?: LogFormat;
    output?: LogOutput;
    filePath?: string;
    maxFileSize?: number;
    maxFiles?: number;
    correlationIdHeader?: string;
    defaultMeta?: Record<string, unknown>;
}
/**
 * Span status
 */
export type SpanStatus = "ok" | "error";
/**
 * Span event
 */
export interface SpanEvent {
    name: string;
    timestamp: number;
    attributes?: Record<string, string | number | boolean>;
}
/**
 * Span link
 */
export interface SpanLink {
    traceId: string;
    spanId: string;
}
/**
 * Span
 */
export interface Span {
    name: string;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    startTime: number;
    endTime?: number;
    status: SpanStatus;
    attributes: Record<string, string | number | boolean>;
    events: SpanEvent[];
    links: SpanLink[];
}
/**
 * Start span options
 */
export interface StartSpanOptions {
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
    links?: SpanLink[];
}
/**
 * Tracer configuration
 */
export interface TracerConfig {
    serviceName: string;
    exporter: "console" | "otlp" | "jaeger";
    endpoint?: string;
    sampleRate: number;
    logLevel?: LogLevel;
}
/**
 * Metric types
 */
export type MetricType = "counter" | "gauge" | "histogram" | "summary";
/**
 * Labels for metrics
 */
export type Labels = Record<string, string>;
/**
 * Counter metric
 */
export interface Counter {
    name: string;
    help: string;
    labels: string[];
    value: Map<string, number>;
}
/**
 * Gauge metric
 */
export interface Gauge {
    name: string;
    help: string;
    labels: string[];
    value: Map<string, number>;
}
/**
 * Histogram bucket
 */
export interface HistogramBucket {
    le: number;
    count: number;
}
/**
 * Histogram metric
 */
export interface Histogram {
    name: string;
    help: string;
    labels: string[];
    buckets: HistogramBucket[];
    sum: Map<string, number>;
    count: Map<string, number>;
}
/**
 * Quantile for summary
 */
export interface SummaryQuantile {
    quantile: number;
    value: number;
}
/**
 * Summary metric
 */
export interface Summary {
    name: string;
    help: string;
    labels: string[];
    quantiles: SummaryQuantile[];
    sum: Map<string, number>;
    count: Map<string, number>;
}
/**
 * Metrics configuration
 */
export interface MetricsConfig {
    serviceName?: string;
    defaultLabels?: Labels;
    exportInterval?: number;
    prefix?: string;
}
/**
 * Prometheus format metric output
 */
export interface PrometheusMetric {
    name: string;
    help: string;
    type: MetricType;
    values: Array<{
        labels: Labels;
        value: number;
    }>;
}
/**
 * Health check result
 */
export interface HealthResult {
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
    details?: Record<string, unknown>;
    timestamp: string;
}
/**
 * Health check function
 */
export type HealthCheck = () => Promise<HealthResult>;
/**
 * Health check registration
 */
export interface HealthCheckRegistration {
    name: string;
    check: HealthCheck;
    critical: boolean;
}
/**
 * Health report
 */
export interface HealthReport {
    overall: "healthy" | "degraded" | "unhealthy";
    version: string;
    uptime: number;
    checks: Record<string, HealthResult>;
    timestamp: string;
}
/**
 * Alert condition types
 */
export type AlertConditionType = "threshold" | "rate" | "error_rate";
/**
 * Threshold condition
 */
export interface ThresholdCondition {
    type: "threshold";
    metric: string;
    operator: ">" | "<" | ">=" | "<=" | "==";
    value: number;
}
/**
 * Rate condition
 */
export interface RateCondition {
    type: "rate";
    metric: string;
    window: number;
    threshold: number;
}
/**
 * Error rate condition
 */
export interface ErrorRateCondition {
    type: "error_rate";
    component: string;
    threshold: number;
}
/**
 * Alert condition
 */
export type AlertCondition = ThresholdCondition | RateCondition | ErrorRateCondition;
/**
 * Alert severity
 */
export type AlertSeverity = "info" | "warning" | "critical";
/**
 * Alert action types
 */
export type AlertActionType = "log" | "notify" | "webhook" | "execute";
/**
 * Log action
 */
export interface LogAction {
    type: "log";
    level: LogLevel;
}
/**
 * Notify action
 */
export interface NotifyAction {
    type: "notify";
    channel: string;
    message: string;
}
/**
 * Webhook action
 */
export interface WebhookAction {
    type: "webhook";
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
}
/**
 * Execute action
 */
export interface ExecuteAction {
    type: "execute";
    command: string;
}
/**
 * Alert action
 */
export type AlertAction = LogAction | NotifyAction | WebhookAction | ExecuteAction;
/**
 * Alert rule
 */
export interface AlertRule {
    name: string;
    condition: AlertCondition;
    severity: AlertSeverity;
    cooldown: number;
    actions: AlertAction[];
    enabled?: boolean;
}
/**
 * Alert
 */
export interface Alert {
    ruleName: string;
    severity: AlertSeverity;
    message: string;
    triggeredAt: string;
    resolvedAt?: string;
    fired: boolean;
    metadata?: Record<string, unknown>;
}
/**
 * Exporter types
 */
export type ExporterType = "prometheus" | "otlp" | "json";
/**
 * Export result
 */
export interface ExportResult {
    format: ExporterType;
    content: string;
    timestamp: string;
}
//# sourceMappingURL=types.d.ts.map