/**
 * Observability Package - Metrics
 *
 * Metrics collection with Prometheus-compatible format.
 */
import type { Labels, MetricsConfig } from "./types.js";
export declare class Timer {
    private startTime;
    constructor();
    /**
     * Get elapsed time in seconds
     */
    elapsed(): number;
    /**
     * Reset the timer
     */
    reset(): void;
}
export declare class Metrics {
    private readonly config;
    private readonly counters;
    private readonly gauges;
    private readonly histograms;
    private readonly histogramSums;
    private readonly histogramCounts;
    private readonly summaries;
    constructor(config?: MetricsConfig);
    /**
     * Generate label key from labels
     */
    private labelKey;
    /**
     * Get full metric name with prefix
     */
    private fullName;
    /**
     * Create default histogram buckets
     */
    private defaultBuckets;
    /**
     * Register a counter metric
     */
    registerCounter(name: string, _help: string, _labels?: string[]): void;
    /**
     * Increment a counter
     */
    incrementCounter(name: string, labels?: Labels): void;
    /**
     * Add to a counter
     */
    addToCounter(name: string, value: number, labels?: Labels): void;
    /**
     * Get counter value
     */
    getCounter(name: string, labels?: Labels): number;
    /**
     * Register a gauge metric
     */
    registerGauge(name: string, _help: string, _labels?: string[]): void;
    /**
     * Set a gauge value
     */
    setGauge(name: string, value: number, labels?: Labels): void;
    /**
     * Increment a gauge
     */
    incrementGauge(name: string, labels?: Labels): void;
    /**
     * Decrement a gauge
     */
    decrementGauge(name: string, labels?: Labels): void;
    /**
     * Register a histogram metric
     */
    registerHistogram(name: string, _help: string, buckets?: number[], _labels?: string[]): void;
    /**
     * Create histogram buckets
     */
    private createBuckets;
    /**
     * Observe a value for histogram
     */
    observeHistogram(name: string, value: number, labels?: Labels): void;
    /**
     * Register a summary metric
     */
    registerSummary(name: string, _help: string, _labels?: string[]): void;
    /**
     * Observe a value for summary
     */
    observeSummary(name: string, value: number, labels?: Labels): void;
    /**
     * Start a timer
     */
    startTimer(): Timer;
    /**
     * Observe duration from timer
     */
    observeDuration(name: string, timer: Timer, labels?: Labels): void;
    /**
     * Async timer wrapper
     */
    asyncTimer<T>(name: string, fn: () => Promise<T>, labels?: Labels): Promise<T>;
    /**
     * Sync timer wrapper
     */
    timer<T>(name: string, fn: () => T, labels?: Labels): T;
    /**
     * Export metrics in Prometheus format
     */
    exportPrometheus(): string;
    /**
     * Export metrics as JSON
     */
    exportJSON(): string;
    /**
     * Clear all metrics
     */
    clear(): void;
}
/**
 * Create built-in runtime metrics
 */
export declare function createBuiltInMetrics(metrics: Metrics): void;
/**
 * Create a metrics collector with the given configuration
 */
export declare function createMetrics(config?: MetricsConfig): Metrics;
//# sourceMappingURL=metrics.d.ts.map