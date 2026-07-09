/**
 * Observability Package - Metrics
 *
 * Metrics collection with Prometheus-compatible format.
 */

import type { HistogramBucket, Labels, MetricsConfig } from "./types.js";

// ─── Default Configuration ─────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<MetricsConfig> = {
	serviceName: "unknown",
	defaultLabels: {},
	exportInterval: 60000,
	prefix: "",
};

// ─── Timer Helper ─────────────────────────────────────────────────────────

export class Timer {
	private startTime: number;

	constructor() {
		this.startTime = Date.now();
	}

	/**
	 * Get elapsed time in seconds
	 */
	elapsed(): number {
		return (Date.now() - this.startTime) / 1000;
	}

	/**
	 * Reset the timer
	 */
	reset(): void {
		this.startTime = Date.now();
	}
}

// ─── Metrics Collector ────────────────────────────────────────────────────

export class Metrics {
	private readonly config: Required<MetricsConfig>;
	private readonly counters: Map<string, Map<string, number>> = new Map();
	private readonly gauges: Map<string, Map<string, number>> = new Map();
	private readonly histograms: Map<string, HistogramBucket[]> = new Map();
	private readonly histogramSums: Map<string, Map<string, number>> = new Map();
	private readonly histogramCounts: Map<string, Map<string, number>> =
		new Map();
	private readonly summaries: Map<
		string,
		Map<string, { sum: number; count: number }>
	> = new Map();

	constructor(config: MetricsConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Generate label key from labels
	 */
	private labelKey(labels?: Labels): string {
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
	private fullName(name: string): string {
		return this.config.prefix ? `${this.config.prefix}_${name}` : name;
	}

	/**
	 * Create default histogram buckets
	 */
	private defaultBuckets(): number[] {
		return [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
	}

	// ─── Counter Methods ──────────────────────────────────────────────────

	/**
	 * Register a counter metric
	 */
	registerCounter(name: string, _help: string, _labels?: string[]): void {
		// Counters are lazily initialized
		this.counters.set(this.fullName(name), new Map());
	}

	/**
	 * Increment a counter
	 */
	incrementCounter(name: string, labels?: Labels): void {
		const fullName = this.fullName(name);
		const key = this.labelKey(labels);

		if (!this.counters.has(fullName)) {
			this.counters.set(fullName, new Map());
		}

		const counter = this.counters.get(fullName)!;
		counter.set(key, (counter.get(key) ?? 0) + 1);
	}

	/**
	 * Add to a counter
	 */
	addToCounter(name: string, value: number, labels?: Labels): void {
		const fullName = this.fullName(name);
		const key = this.labelKey(labels);

		if (!this.counters.has(fullName)) {
			this.counters.set(fullName, new Map());
		}

		const counter = this.counters.get(fullName)!;
		counter.set(key, (counter.get(key) ?? 0) + value);
	}

	/**
	 * Get counter value
	 */
	getCounter(name: string, labels?: Labels): number {
		const fullName = this.fullName(name);
		const key = this.labelKey(labels);
		return this.counters.get(fullName)?.get(key) ?? 0;
	}

	// ─── Gauge Methods ──────────────────────────────────────────────────

	/**
	 * Register a gauge metric
	 */
	registerGauge(name: string, _help: string, _labels?: string[]): void {
		this.gauges.set(this.fullName(name), new Map());
	}

	/**
	 * Set a gauge value
	 */
	setGauge(name: string, value: number, labels?: Labels): void {
		const fullName = this.fullName(name);
		const key = this.labelKey(labels);

		if (!this.gauges.has(fullName)) {
			this.gauges.set(fullName, new Map());
		}

		const gauge = this.gauges.get(fullName)!;
		gauge.set(key, value);
	}

	/**
	 * Increment a gauge
	 */
	incrementGauge(name: string, labels?: Labels): void {
		const fullName = this.fullName(name);
		const key = this.labelKey(labels);

		if (!this.gauges.has(fullName)) {
			this.gauges.set(fullName, new Map());
		}

		const gauge = this.gauges.get(fullName)!;
		gauge.set(key, (gauge.get(key) ?? 0) + 1);
	}

	/**
	 * Decrement a gauge
	 */
	decrementGauge(name: string, labels?: Labels): void {
		const fullName = this.fullName(name);
		const key = this.labelKey(labels);

		if (!this.gauges.has(fullName)) {
			this.gauges.set(fullName, new Map());
		}

		const gauge = this.gauges.get(fullName)!;
		gauge.set(key, (gauge.get(key) ?? 0) - 1);
	}

	// ─── Histogram Methods ───────────────────────────────────────────────

	/**
	 * Register a histogram metric
	 */
	registerHistogram(
		name: string,
		_help: string,
		buckets?: number[],
		_labels?: string[],
	): void {
		const fullName = this.fullName(name);
		this.histograms.set(fullName, this.createBuckets(buckets));
		this.histogramSums.set(fullName, new Map());
		this.histogramCounts.set(fullName, new Map());
	}

	/**
	 * Create histogram buckets
	 */
	private createBuckets(customBuckets?: number[]): HistogramBucket[] {
		const buckets = customBuckets ?? this.defaultBuckets();
		return buckets.map((le) => ({ le, count: 0 }));
	}

	/**
	 * Observe a value for histogram
	 */
	observeHistogram(name: string, value: number, labels?: Labels): void {
		const fullName = this.fullName(name);
		const key = this.labelKey(labels);

		// Update sum and count
		if (!this.histogramSums.has(fullName)) {
			this.histogramSums.set(fullName, new Map());
		}
		const sumMap = this.histogramSums.get(fullName)!;
		sumMap.set(key, (sumMap.get(key) ?? 0) + value);

		if (!this.histogramCounts.has(fullName)) {
			this.histogramCounts.set(fullName, new Map());
		}
		const countMap = this.histogramCounts.get(fullName)!;
		countMap.set(key, (countMap.get(key) ?? 0) + 1);

		// Update buckets
		if (!this.histograms.has(fullName)) {
			this.histograms.set(fullName, this.createBuckets());
		}

		const histogram = this.histograms.get(fullName)!;
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
	registerSummary(name: string, _help: string, _labels?: string[]): void {
		this.summaries.set(this.fullName(name), new Map());
	}

	/**
	 * Observe a value for summary
	 */
	observeSummary(name: string, value: number, labels?: Labels): void {
		const fullName = this.fullName(name);
		const key = this.labelKey(labels);

		if (!this.summaries.has(fullName)) {
			this.summaries.set(fullName, new Map());
		}

		const summary = this.summaries.get(fullName)!;
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
	startTimer(): Timer {
		return new Timer();
	}

	/**
	 * Observe duration from timer
	 */
	observeDuration(name: string, timer: Timer, labels?: Labels): void {
		this.observeHistogram(name, timer.elapsed(), labels);
	}

	/**
	 * Async timer wrapper
	 */
	async asyncTimer<T>(
		name: string,
		fn: () => Promise<T>,
		labels?: Labels,
	): Promise<T> {
		const timer = this.startTimer();
		try {
			const result = await fn();
			this.observeDuration(name, timer, labels);
			return result;
		} catch (error) {
			this.observeDuration(name, timer, labels);
			throw error;
		}
	}

	/**
	 * Sync timer wrapper
	 */
	timer<T>(name: string, fn: () => T, labels?: Labels): T {
		const timer = this.startTimer();
		try {
			return fn();
		} finally {
			this.observeDuration(name, timer, labels);
		}
	}

	// ─── Export Methods ──────────────────────────────────────────────────

	/**
	 * Export metrics in Prometheus format
	 */
	exportPrometheus(): string {
		const lines: string[] = [];

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
	exportJSON(): string {
		const data = {
			service: this.config.serviceName,
			timestamp: new Date().toISOString(),
			counters: Object.fromEntries(
				Array.from(this.counters.entries()).map(([k, v]) => [
					k,
					Object.fromEntries(v),
				]),
			),
			gauges: Object.fromEntries(
				Array.from(this.gauges.entries()).map(([k, v]) => [
					k,
					Object.fromEntries(v),
				]),
			),
		};
		return JSON.stringify(data, null, 2);
	}

	/**
	 * Clear all metrics
	 */
	clear(): void {
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
export function createBuiltInMetrics(metrics: Metrics): void {
	// Job metrics
	metrics.registerCounter("harness_jobs_total", "Total jobs created");
	metrics.registerCounter("harness_jobs_completed", "Completed jobs");
	metrics.registerCounter("harness_jobs_failed", "Failed jobs");
	metrics.registerGauge("harness_jobs_active", "Currently active jobs");

	// Task metrics
	metrics.registerCounter("harness_tasks_total", "Total tasks created");
	metrics.registerCounter("harness_tasks_retries_total", "Task retry count");
	metrics.registerHistogram(
		"harness_tasks_duration_seconds",
		"Task duration in seconds",
		[1, 5, 10, 30, 60, 120, 300, 600],
	);

	// Provider metrics
	metrics.registerCounter(
		"harness_provider_requests_total",
		"Total provider requests",
	);
	metrics.registerCounter("harness_provider_errors_total", "Provider errors");
	metrics.registerHistogram(
		"harness_provider_latency_seconds",
		"Provider request latency in seconds",
		[0.1, 0.25, 0.5, 1, 2.5, 5, 10],
	);
	metrics.registerCounter("harness_provider_tokens_total", "Total tokens used");

	// Session metrics
	metrics.registerGauge("harness_sessions_active", "Active sessions");
	metrics.registerCounter(
		"harness_sessions_tokens_total",
		"Total session tokens",
	);
}

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Create a metrics collector with the given configuration
 */
export function createMetrics(config?: MetricsConfig): Metrics {
	return new Metrics(config);
}
