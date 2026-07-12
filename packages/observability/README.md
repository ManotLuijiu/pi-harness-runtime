# @pi/observability

Comprehensive observability system with structured logging, distributed tracing, metrics collection, health monitoring, and alerting.

## Features

- **Structured Logging** - JSON and pretty-printed logs with correlation IDs
- **Distributed Tracing** - OpenTelemetry-compatible tracing with spans and events
- **Metrics Collection** - Prometheus-compatible metrics (counters, gauges, histograms)
- **Health Monitoring** - Liveness and readiness probes for Kubernetes
- **Alerting Engine** - Rule-based alerts with multiple action types

## Installation

```bash
npm install @pi/observability
```

## Quick Start

### Structured Logging

```typescript
import { createLogger } from "@pi/observability";

const logger = createLogger({
  level: "info",
  format: "json",
  output: "stdout"
});

// Basic logging
logger.info("Application started");
logger.error("Request failed", { requestId: "123" });

// With correlation
const jobLogger = logger.withJob("job-123");
jobLogger.info("Processing task");
```

### Distributed Tracing

```typescript
import { createTracer } from "@pi/observability";

const tracer = createTracer({
  serviceName: "my-service",
  exporter: "console",
  sampleRate: 1.0
});

// Trace a function
const result = await tracer.trace("processOrder", async (span) => {
  span.setAttribute("orderId", order.id);
  
  await tracer.trace("validateOrder", async () => {
    // validation logic
  });
  
  return result;
});
```

### Metrics

```typescript
import { createMetrics, createBuiltInMetrics } from "@pi/observability";

const metrics = createMetrics({ serviceName: "my-service" });
createBuiltInMetrics(metrics);

// Counter
metrics.incrementCounter("requests_total", { endpoint: "/api" });

// Gauge
metrics.setGauge("active_connections", 42);

// Histogram
metrics.observeHistogram("request_duration_seconds", 0.125, { method: "GET" });

// Export metrics
const prometheusOutput = metrics.exportPrometheus();
```

### Health Checks

```typescript
import { createHealthMonitor, createMemoryHealthCheck } from "@pi/observability";

const health = createHealthMonitor("my-service", "1.0.0");

// Register checks
health.registerHealthCheck("memory", createMemoryHealthCheck("memory", 90));

// Kubernetes probes
app.get("/health/liveness", async (req, res) => {
  const result = await health.checkLiveness();
  res.status(result.status === "healthy" ? 200 : 503).json(result);
});

app.get("/health/readiness", async (req, res) => {
  const result = await health.checkReadiness();
  res.status(result.status === "healthy" ? 200 : 503).json(result);
});
```

### Alerting

```typescript
import { createAlertEngine } from "@pi/observability";

const alertEngine = createAlertEngine();

alertEngine.registerRule({
  name: "high_error_rate",
  condition: {
    type: "threshold",
    metric: "error_rate",
    operator: ">",
    value: 0.05
  },
  severity: "critical",
  cooldown: 300000, // 5 minutes
  actions: [
    { type: "log", level: "error" },
    { type: "notify", channel: "slack", message: "High error rate detected" }
  ]
});

// Evaluate alerts
const alerts = await alertEngine.evaluate(metrics);
```

## API Reference

### Logger

```typescript
const logger = createLogger({
  level: "debug" | "info" | "warn" | "error" | "fatal",
  format: "json" | "pretty",
  output: "stdout" | "stderr" | "file",
  filePath?: string,
  defaultMeta?: Record<string, unknown>
});

logger.debug(message, meta?);
logger.info(message, meta?);
logger.warn(message, meta?);
logger.error(message, error?, meta?);
logger.fatal(message, error?, meta?);

logger.child(defaults);  // Create child logger
logger.withJob(jobId);   // Attach job ID
logger.withTask(taskId); // Attach task ID
logger.withCorrelationId(id); // Set correlation ID
```

### Tracer

```typescript
const tracer = createTracer({
  serviceName: string,
  exporter: "console" | "otlp" | "jaeger",
  endpoint?: string,
  sampleRate?: number
});

tracer.startSpan(name, options?);
tracer.trace(name, fn);
tracer.trace(name, options, fn);
tracer.traceSync(name, fn);
```

### Metrics

```typescript
const metrics = createMetrics({
  serviceName: string,
  prefix?: string,
  defaultLabels?: Labels
});

metrics.registerCounter(name, help, labels?);
metrics.incrementCounter(name, labels?);
metrics.registerGauge(name, help, labels?);
metrics.setGauge(name, value, labels?);
metrics.registerHistogram(name, help, buckets?, labels?);
metrics.observeHistogram(name, value, labels?);

metrics.asyncTimer(name, fn, labels?);
metrics.timer(name, fn, labels?);

metrics.exportPrometheus();
metrics.exportJSON();
```

### Health Monitor

```typescript
const health = createHealthMonitor(serviceName, version);

health.registerHealthCheck(name, check, critical?);
health.checkHealth(name);
health.checkHealthAll();
health.checkLiveness();
health.checkReadiness();
```

### Alert Engine

```typescript
const alertEngine = createAlertEngine(logger?);

alertEngine.registerRule(rule);
alertEngine.unregisterRule(name);
alertEngine.evaluate(metrics);
alertEngine.getActiveAlerts();
alertEngine.getAlertHistory(limit?);
```

## Metrics Format

Prometheus format example:

```
# HELP my_service_requests_total Total requests
# TYPE my_service_requests_total counter
my_service_requests_total{endpoint="/api"} 1234

# HELP my_service_request_duration_seconds Request duration
# TYPE my_service_request_duration_seconds histogram
my_service_request_duration_seconds_bucket{le="0.1"} 1000
my_service_request_duration_seconds_bucket{le="0.5"} 1200
my_service_request_duration_seconds_sum 150.5
my_service_request_duration_seconds_count 1234
```

## License

MIT
