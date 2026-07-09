/**
 * Observability Package - Metrics
 *
 * Metrics collection with Prometheus-compatible format.
 */
// ─── Default Configuration ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    serviceName: "unknown",
    defaultLabels: {},
    exportInterval: 60000,
    prefix: "",
};
// ─── Timer Helper ─────────────────────────────────────────────────────────
export class Timer {
    startTime;
    constructor() {
        this.startTime = Date.now();
    }
    /**
     * Get elapsed time in seconds
     */
    elapsed() {
        return (Date.now() - this.startTime) / 1000;
    }
    /**
     * Reset the timer
     */
    reset() {
        this.startTime = Date.now();
    }
}
// ─── Metrics Collector ────────────────────────────────────────────────────
export class Metrics {
    config;
    counters = new Map();
    gauges = new Map();
    histograms = new Map();
    histogramSums = new Map();
    histogramCounts = new Map();
    summaries = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Generate label key from labels
     */
    labelKey(labels) {
        if (!labels || Object.keys(labels).length === 0) {
            return "";
        }
        return Object.entries(labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(",");
    }
    /**
     * Get full metric name with prefix
     */
    fullName(name) {
        return this.config.prefix ? `${this.config.prefix}_${name}` : name;
    }
    /**
     * Create default histogram buckets
     */
    defaultBuckets() {
        return [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    }
    // ─── Counter Methods ──────────────────────────────────────────────────
    /**
     * Register a counter metric
     */
    registerCounter(name, _help, _labels) {
        // Counters are lazily initialized
        this.counters.set(this.fullName(name), new Map());
    }
    /**
     * Increment a counter
     */
    incrementCounter(name, labels) {
        const fullName = this.fullName(name);
        const key = this.labelKey(labels);
        if (!this.counters.has(fullName)) {
            this.counters.set(fullName, new Map());
        }
        const counter = this.counters.get(fullName);
        counter.set(key, (counter.get(key) ?? 0) + 1);
    }
    /**
     * Add to a counter
     */
    addToCounter(name, value, labels) {
        const fullName = this.fullName(name);
        const key = this.labelKey(labels);
        if (!this.counters.has(fullName)) {
            this.counters.set(fullName, new Map());
        }
        const counter = this.counters.get(fullName);
        counter.set(key, (counter.get(key) ?? 0) + value);
    }
    /**
     * Get counter value
     */
    getCounter(name, labels) {
        const fullName = this.fullName(name);
        const key = this.labelKey(labels);
        return this.counters.get(fullName)?.get(key) ?? 0;
    }
    // ─── Gauge Methods ──────────────────────────────────────────────────
    /**
     * Register a gauge metric
     */
    registerGauge(name, _help, _labels) {
        this.gauges.set(this.fullName(name), new Map());
    }
    /**
     * Set a gauge value
     */
    setGauge(name, value, labels) {
        const fullName = this.fullName(name);
        const key = this.labelKey(labels);
        if (!this.gauges.has(fullName)) {
            this.gauges.set(fullName, new Map());
        }
        const gauge = this.gauges.get(fullName);
        gauge.set(key, value);
    }
    /**
     * Increment a gauge
     */
    incrementGauge(name, labels) {
        const fullName = this.fullName(name);
        const key = this.labelKey(labels);
        if (!this.gauges.has(fullName)) {
            this.gauges.set(fullName, new Map());
        }
        const gauge = this.gauges.get(fullName);
        gauge.set(key, (gauge.get(key) ?? 0) + 1);
    }
    /**
     * Decrement a gauge
     */
    decrementGauge(name, labels) {
        const fullName = this.fullName(name);
        const key = this.labelKey(labels);
        if (!this.gauges.has(fullName)) {
            this.gauges.set(fullName, new Map());
        }
        const gauge = this.gauges.get(fullName);
        gauge.set(key, (gauge.get(key) ?? 0) - 1);
    }
    // ─── Histogram Methods ───────────────────────────────────────────────
    /**
     * Register a histogram metric
     */
    registerHistogram(name, _help, buckets, _labels) {
        const fullName = this.fullName(name);
        this.histograms.set(fullName, this.createBuckets(buckets));
        this.histogramSums.set(fullName, new Map());
        this.histogramCounts.set(fullName, new Map());
    }
    /**
     * Create histogram buckets
     */
    createBuckets(customBuckets) {
        const buckets = customBuckets ?? this.defaultBuckets();
        return buckets.map((le) => ({ le, count: 0 }));
    }
    /**
     * Observe a value for histogram
     */
    observeHistogram(name, value, labels) {
        const fullName = this.fullName(name);
        const key = this.labelKey(labels);
        // Update sum and count
        if (!this.histogramSums.has(fullName)) {
            this.histogramSums.set(fullName, new Map());
        }
        const sumMap = this.histogramSums.get(fullName);
        sumMap.set(key, (sumMap.get(key) ?? 0) + value);
        if (!this.histogramCounts.has(fullName)) {
            this.histogramCounts.set(fullName, new Map());
        }
        const countMap = this.histogramCounts.get(fullName);
        countMap.set(key, (countMap.get(key) ?? 0) + 1);
        // Update buckets
        if (!this.histograms.has(fullName)) {
            this.histograms.set(fullName, this.createBuckets());
        }
        const histogram = this.histograms.get(fullName);
        for (const bucket of histogram) {
            if (value <= bucket.le) {
                bucket.count++;
            }
        }
    }
    // ─── Summary Methods ─────────────────────────────────────────────────
    /**
     * Register a summary metric
     */
    registerSummary(name, _help, _labels) {
        this.summaries.set(this.fullName(name), new Map());
    }
    /**
     * Observe a value for summary
     */
    observeSummary(name, value, labels) {
        const fullName = this.fullName(name);
        const key = this.labelKey(labels);
        if (!this.summaries.has(fullName)) {
            this.summaries.set(fullName, new Map());
        }
        const summary = this.summaries.get(fullName);
        const current = summary.get(key) ?? { sum: 0, count: 0 };
        summary.set(key, {
            sum: current.sum + value,
            count: current.count + 1,
        });
    }
    // ─── Timing Helpers ─────────────────────────────────────────────────
    /**
     * Start a timer
     */
    startTimer() {
        return new Timer();
    }
    /**
     * Observe duration from timer
     */
    observeDuration(name, timer, labels) {
        this.observeHistogram(name, timer.elapsed(), labels);
    }
    /**
     * Async timer wrapper
     */
    async asyncTimer(name, fn, labels) {
        const timer = this.startTimer();
        try {
            const result = await fn();
            this.observeDuration(name, timer, labels);
            return result;
        }
        catch (error) {
            this.observeDuration(name, timer, labels);
            throw error;
        }
    }
    /**
     * Sync timer wrapper
     */
    timer(name, fn, labels) {
        const timer = this.startTimer();
        try {
            return fn();
        }
        finally {
            this.observeDuration(name, timer, labels);
        }
    }
    // ─── Export Methods ──────────────────────────────────────────────────
    /**
     * Export metrics in Prometheus format
     */
    exportPrometheus() {
        const lines = [];
        // Service labels
        const serviceLabels = `{service="${this.config.serviceName}"}`;
        // Export counters
        for (const [name, values] of this.counters) {
            lines.push(`# HELP ${name} Counter metric`);
            lines.push(`# TYPE ${name} counter`);
            for (const [labels, value] of values) {
                const labelStr = labels ? `{${labels}}` : serviceLabels;
                lines.push(`${name}${labelStr} ${value}`);
            }
        }
        // Export gauges
        for (const [name, values] of this.gauges) {
            lines.push(`# HELP ${name} Gauge metric`);
            lines.push(`# TYPE ${name} gauge`);
            for (const [labels, value] of values) {
                const labelStr = labels ? `{${labels}}` : serviceLabels;
                lines.push(`${name}${labelStr} ${value}`);
            }
        }
        // Export histograms
        for (const [name, buckets] of this.histograms) {
            lines.push(`# HELP ${name} Histogram metric`);
            lines.push(`# TYPE ${name} histogram`);
            const sumMap = this.histogramSums.get(name) ?? new Map();
            const countMap = this.histogramCounts.get(name) ?? new Map();
            const key = ""; // Simplified for single label set
            // Bucket values
            for (const bucket of buckets) {
                const labelStr = `{${key}}`;
                lines.push(`${name}_bucket${labelStr} ${bucket.count}`);
            }
            // Sum and count
            lines.push(`${name}_sum${serviceLabels} ${sumMap.get(key) ?? 0}`);
            lines.push(`${name}_count${serviceLabels} ${countMap.get(key) ?? 0}`);
        }
        // Export summaries
        for (const [name, values] of this.summaries) {
            lines.push(`# HELP ${name} Summary metric`);
            lines.push(`# TYPE ${name} summary`);
            const serviceLabels = `{service="${this.config.serviceName}"}`;
            for (const [labels, data] of values) {
                const labelStr = labels ? `{${labels}}` : serviceLabels;
                lines.push(`${name}_sum${labelStr} ${data.sum}`);
                lines.push(`${name}_count${labelStr} ${data.count}`);
            }
        }
        return `${lines.join("\n")}\n`;
    }
    /**
     * Export metrics as JSON
     */
    exportJSON() {
        const data = {
            service: this.config.serviceName,
            timestamp: new Date().toISOString(),
            counters: Object.fromEntries(Array.from(this.counters.entries()).map(([k, v]) => [
                k,
                Object.fromEntries(v),
            ])),
            gauges: Object.fromEntries(Array.from(this.gauges.entries()).map(([k, v]) => [
                k,
                Object.fromEntries(v),
            ])),
        };
        return JSON.stringify(data, null, 2);
    }
    /**
     * Clear all metrics
     */
    clear() {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
        this.histogramSums.clear();
        this.histogramCounts.clear();
        this.summaries.clear();
    }
}
// ─── Built-in Metrics ────────────────────────────────────────────────────────
/**
 * Create built-in runtime metrics
 */
export function createBuiltInMetrics(metrics) {
    // Job metrics
    metrics.registerCounter("harness_jobs_total", "Total jobs created");
    metrics.registerCounter("harness_jobs_completed", "Completed jobs");
    metrics.registerCounter("harness_jobs_failed", "Failed jobs");
    metrics.registerGauge("harness_jobs_active", "Currently active jobs");
    // Task metrics
    metrics.registerCounter("harness_tasks_total", "Total tasks created");
    metrics.registerCounter("harness_tasks_retries_total", "Task retry count");
    metrics.registerHistogram("harness_tasks_duration_seconds", "Task duration in seconds", [1, 5, 10, 30, 60, 120, 300, 600]);
    // Provider metrics
    metrics.registerCounter("harness_provider_requests_total", "Total provider requests");
    metrics.registerCounter("harness_provider_errors_total", "Provider errors");
    metrics.registerHistogram("harness_provider_latency_seconds", "Provider request latency in seconds", [0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
    metrics.registerCounter("harness_provider_tokens_total", "Total tokens used");
    // Session metrics
    metrics.registerGauge("harness_sessions_active", "Active sessions");
    metrics.registerCounter("harness_sessions_tokens_total", "Total session tokens");
}
// ─── Factory Function ────────────────────────────────────────────────────────
/**
 * Create a metrics collector with the given configuration
 */
export function createMetrics(config) {
    return new Metrics(config);
}
//# sourceMappingURL=metrics.js.map