# RFC 0034: Observability

## Summary

A comprehensive observability system for monitoring, tracing, metrics collection, and alerting in the harness runtime.

## Motivation

Currently, observability is minimal with scattered logging. We need:

1. Structured logging with correlation IDs
2. Distributed tracing across components
3. Metrics collection and export
4. Health endpoints
5. Alerting system
6. Dashboard-ready data exports

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Observability System                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Logger     │  │   Tracer     │  │   Metrics    │             │
│  │   (Structured│  │   (OpenTelemetry│  │   (Prometheus│           │
│  │    Logging)  │  │    Compatible)│  │    Format)  │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Health     │  │   Alerts     │  │   Exporters  │             │
│  │   Monitor     │  │   Engine     │  │   (Prom/OTLP)│           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Logger

```typescript
interface LoggerConfig {
  level: LogLevel;                   // 'debug' | 'info' | 'warn' | 'error'
  format: 'json' | 'pretty';        // Output format
  output: 'stdout' | 'file' | 'both';
  filePath?: string;
  maxFileSize?: number;             // Rotation size in bytes
  maxFiles?: number;               // Number of rotated files to keep
  correlationIdHeader?: string;     // Header name for correlation ID
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
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

class Logger {
  constructor(config: LoggerConfig);
  
  debug(message: string, meta?: object): void;
  info(message: string, meta?: object): void;
  warn(message: string, meta?: object): void;
  error(message: string, error?: Error, meta?: object): void;
  fatal(message: string, error?: Error, meta?: object): void;
  
  // Child logger with defaults
  child(defaults: Partial<LogEntry>): Logger;
  
  // Correlation
  withCorrelationId(id: string): Logger;
  withJob(jobId: string): Logger;
  withTask(taskId: string): Logger;
}
```

### 2. Tracer (OpenTelemetry Compatible)

```typescript
interface TracerConfig {
  serviceName: string;
  exporter: 'console' | 'otlp' | 'jaeger';
  endpoint?: string;
  sampleRate: number;              // 0-1, percentage to sample
}

interface Span {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  links: SpanLink[];
}

interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string>;
}

interface SpanLink {
  traceId: string;
  spanId: string;
}

class Tracer {
  constructor(config: TracerConfig);
  
  startSpan(name: string, options?: StartSpanOptions): SpanHandle;
  recordException(span: SpanHandle, error: Error): void;
  addEvent(span: SpanHandle, name: string, attributes?: object): void;
  getCurrentSpan(): SpanHandle | null;
  
  // Async wrapper
  trace<T>(name: string, fn: () => Promise<T>): Promise<T>;
  trace<T>(name: string, options: SpanOptions, fn: () => Promise<T>): Promise<T>;
}

interface SpanHandle {
  end(): void;
  setStatus(status: 'ok' | 'error'): void;
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attributes?: object): void;
  recordException(error: Error): void;
}
```

### 3. Metrics Collector

```typescript
interface MetricsConfig {
  serviceName: string;
  defaultLabels: Record<string, string>;
  exportInterval: number;          // How often to flush metrics
}

class Metrics {
  constructor(config: MetricsConfig);
  
  // Counters
  counter(name: string, help: string, labels?: string[]): Counter;
  increment(name: string, value?: number, labels?: Labels): void;
  
  // Gauges
  gauge(name: string, help: string, labels?: string[]): Gauge;
  set(name: string, value: number, labels?: Labels): void;
  
  // Histograms
  histogram(name: string, help: string, buckets?: number[], labels?: string[]): Histogram;
  observe(name: string, value: number, labels?: Labels): void;
  
  // Summaries
  summary(name: string, help: string, labels?: string[]): Summary;
  
  // Timing helpers
  timer(name: string, labels?: Labels): () => void;
  asyncTimer<T>(name: string, fn: () => Promise<T>, labels?: Labels): Promise<T>;
  
  // Export
  async export(): Promise<MetricsSnapshot>;
  async exportPrometheus(): Promise<string>;
}

// Built-in metrics
interface BuiltInMetrics {
  // Job metrics
  'harness_jobs_total': Counter;           // Total jobs created
  'harness_jobs_active': Gauge;           // Currently active jobs
  'harness_jobs_completed': Counter;      // Completed jobs
  'harness_jobs_failed': Counter;         // Failed jobs
  
  // Task metrics
  'harness_tasks_total': Counter;          // Total tasks created
  'harness_tasks_duration_seconds': Histogram; // Task duration
  'harness_tasks_retries_total': Counter; // Task retry count
  
  // Provider metrics
  'harness_provider_requests_total': Counter;
  'harness_provider_errors_total': Counter;
  'harness_provider_latency_seconds': Histogram;
  'harness_provider_tokens_total': Counter;
  
  // Session metrics
  'harness_sessions_active': Gauge;
  'harness_sessions_tokens_total': Counter;
}
```

### 4. Health Monitor

```typescript
interface HealthCheck {
  name: string;
  check: () => Promise<HealthResult>;
  critical: boolean;
}

interface HealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

class HealthMonitor {
  constructor();
  
  registerHealthCheck(check: HealthCheck): void;
  unregisterHealthCheck(name: string): void;
  
  async checkHealth(): Promise<HealthReport>;
  async checkLiveness(): Promise<HealthResult>;  // K8s liveness probe
  async checkReadiness(): Promise<HealthResult>;  // K8s readiness probe
}

interface HealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  checks: Record<string, HealthResult>;
  timestamp: string;
}
```

### 5. Alerting Engine

```typescript
interface AlertRule {
  name: string;
  condition: AlertCondition;
  severity: 'info' | 'warning' | 'critical';
  cooldown: number;                // Minimum time between alerts
  actions: AlertAction[];
}

type AlertCondition = 
  | { type: 'threshold'; metric: string; op: '>' | '<' | '=='; value: number }
  | { type: 'rate'; metric: string; window: number; threshold: number }
  | { type: 'error_rate'; component: string; threshold: number };

type AlertAction =
  | { type: 'log'; level: LogLevel }
  | { type: 'notify'; channel: string; message: string }
  | { type: 'webhook'; url: string }
  | { type: 'execute'; command: string };

class AlertEngine {
  constructor();
  
  registerRule(rule: AlertRule): void;
  unregisterRule(name: string): void;
  
  evaluate(): Promise<Alert[]>;
  triggerAlert(alert: Alert): Promise<void>;
  getActiveAlerts(): Alert[];
  getAlertHistory(): Alert[];
}
```

## File Structure

```
packages/observability/
├── src/
│   ├── index.ts                    # Public exports
│   ├── logger.ts                  # Structured logger
│   ├── tracer.ts                  # Distributed tracer
│   ├── metrics.ts                 # Metrics collector
│   ├── health.ts                  # Health monitor
│   ├── alerts.ts                  # Alerting engine
│   ├── exporters/
│   │   ├── prometheus.ts          # Prometheus exporter
│   │   └── otlp.ts                # OTLP exporter
│   ├── middleware.ts              # Express/HTTP middleware
│   ├── types.ts                   # Types
│   └── errors.ts
├── test/
├── examples/
├── package.json
└── README.md
```

## Usage Examples

### Structured Logging

```typescript
import { createLogger } from '@pi/observability';

const logger = createLogger({
  level: 'info',
  format: 'json',
  output: 'both',
  filePath: './logs/harness.log'
});

const jobLogger = logger.withJob('job-123');
jobLogger.info('Job started', { requirement: 'Build a web app' });

// Output: {"timestamp":"...","level":"info","message":"Job started","jobId":"job-123","requirement":"Build a web app","traceId":"..."}
```

### Distributed Tracing

```typescript
import { createTracer } from '@pi/observability';

const tracer = createTracer({
  serviceName: 'harness-runtime',
  exporter: 'otlp',
  endpoint: 'http://localhost:4318'
});

const result = await tracer.trace('processJob', async (span) => {
  span.setAttribute('jobId', 'job-123');
  
  await tracer.trace('planTasks', async () => {
    // ...
  });
  
  return result;
});
```

### Metrics Collection

```typescript
import { createMetrics } from '@pi/observability';

const metrics = createMetrics({ serviceName: 'harness-runtime' });

// Record task duration
const endTimer = metrics.asyncTimer('task_duration', { taskType: 'code' });
await executeTask();
endTimer();

// Check metrics
const snapshot = await metrics.exportPrometheus();
// # HELP harness_task_duration_seconds Task duration
// # TYPE harness_task_duration_seconds histogram
```

### Health Checks

```typescript
const health = new HealthMonitor();

health.registerHealthCheck({
  name: 'providers',
  critical: true,
  check: async () => {
    const providers = await checkProviderHealth();
    return providers.length > 0 
      ? { status: 'healthy' }
      : { status: 'unhealthy', message: 'No providers available' };
  }
});

// K8s endpoints
app.get('/health/liveness', async (req, res) => {
  const result = await health.checkLiveness();
  res.status(result.status === 'healthy' ? 200 : 503).json(result);
});

app.get('/health/readiness', async (req, res) => {
  const result = await health.checkReadiness();
  res.status(result.status === 'healthy' ? 200 : 503).json(result);
});
```

## Integration

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Harness   │────▶│ Observability │────▶│  Prometheus │
│   Runtime   │     │   Package     │     │   Server    │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Grafana    │
                    │  Dashboard   │
                    └──────────────┘
```

## Acceptance Criteria

1. ✅ All log entries include correlation IDs for tracing
2. ✅ Tracer supports OpenTelemetry protocol
3. ✅ Metrics export in Prometheus format
4. ✅ Health endpoints for Kubernetes probes
5. ✅ Alert rules can trigger on metric thresholds
6. ✅ Logs are structured JSON with required fields
7. ✅ Performance overhead < 5% for logging/tracing

## Dependencies

- `packages/types` - for runtime-types
- Optional: `@opentelemetry/sdk-node` - OTLP export
- Optional: `prom-client` - Prometheus format
- No required external dependencies
