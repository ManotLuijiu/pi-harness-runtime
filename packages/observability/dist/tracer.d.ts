/**
 * Observability Package - Tracer
 *
 * Distributed tracing with OpenTelemetry-compatible interface.
 */
import type { Span, SpanStatus, StartSpanOptions, TracerConfig } from "./types.js";
export declare class SpanHandle {
    private readonly tracer;
    private readonly span;
    private ended;
    constructor(tracer: Tracer, span: Span);
    /**
     * End the span
     */
    end(): void;
    /**
     * Set span status
     */
    setStatus(status: SpanStatus): void;
    /**
     * Set an attribute
     */
    setAttribute(key: string, value: string | number | boolean): void;
    /**
     * Add an event to the span
     */
    addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
    /**
     * Record an exception
     */
    recordException(error: Error): void;
    /**
     * Get the underlying span
     */
    getSpan(): Readonly<Span>;
}
export declare class Tracer {
    private readonly config;
    private readonly logger;
    private readonly spans;
    private currentSpan?;
    constructor(config: TracerConfig);
    /**
     * Generate a new trace ID
     */
    private generateTraceId;
    /**
     * Generate a new span ID
     */
    private generateSpanId;
    /**
     * Start a new span
     */
    startSpan(name: string, options?: StartSpanOptions): SpanHandle;
    /**
     * Get the current active span
     */
    getCurrentSpan(): SpanHandle | null;
    /**
     * Record a completed span (called by SpanHandle)
     */
    recordCompletedSpan(span: Span): void;
    /**
     * Export span to console
     */
    private exportToConsole;
    /**
     * Export span to OTLP/Jaeger
     */
    private exportToOTLP;
    /**
     * Wrap an async function with tracing
     */
    trace<T>(name: string, fn: () => Promise<T>): Promise<T>;
    trace<T>(name: string, options: StartSpanOptions, fn: () => Promise<T>): Promise<T>;
    /**
     * Wrap a sync function with tracing
     */
    traceSync<T>(name: string, fn: () => T): T;
    traceSync<T>(name: string, options: StartSpanOptions, fn: () => T): T;
    /**
     * Record an exception on the current span
     */
    recordException(error: Error): void;
    /**
     * Add an event to the current span
     */
    addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
    /**
     * Get all recorded spans
     */
    getSpans(): Readonly<Span>[];
    /**
     * Clear all recorded spans
     */
    clearSpans(): void;
    /**
     * Export all spans
     */
    exportSpans(): Span[];
    /**
     * Create a child tracer
     */
    childTracer(additionalConfig: Partial<TracerConfig>): Tracer;
}
/**
 * Create a tracer with the given configuration
 */
export declare function createTracer(config: TracerConfig): Tracer;
//# sourceMappingURL=tracer.d.ts.map