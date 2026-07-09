/**
 * Observability Package - Tracer
 *
 * Distributed tracing with OpenTelemetry-compatible interface.
 */
import { randomUUID } from "node:crypto";
import { Logger } from "./logger.js";
// ─── Span Handle ─────────────────────────────────────────────────────────────
export class SpanHandle {
    tracer;
    span;
    ended = false;
    constructor(tracer, span) {
        this.tracer = tracer;
        this.span = span;
    }
    /**
     * End the span
     */
    end() {
        if (this.ended)
            return;
        this.ended = true;
        this.span.endTime = Date.now();
        this.tracer.recordCompletedSpan(this.span);
    }
    /**
     * Set span status
     */
    setStatus(status) {
        this.span.status = status;
    }
    /**
     * Set an attribute
     */
    setAttribute(key, value) {
        this.span.attributes[key] = value;
    }
    /**
     * Add an event to the span
     */
    addEvent(name, attributes) {
        const event = {
            name,
            timestamp: Date.now(),
            attributes,
        };
        this.span.events.push(event);
    }
    /**
     * Record an exception
     */
    recordException(error) {
        this.span.status = "error";
        this.addEvent("exception", {
            "exception.type": error.name,
            "exception.message": error.message,
            "exception.stacktrace": error.stack ?? "",
        });
    }
    /**
     * Get the underlying span
     */
    getSpan() {
        return this.span;
    }
}
// ─── Tracer Class ────────────────────────────────────────────────────────────
export class Tracer {
    config;
    logger;
    spans = [];
    currentSpan;
    constructor(config) {
        this.config = config;
        this.logger = new Logger({ level: config.logLevel ?? "warn" });
    }
    /**
     * Generate a new trace ID
     */
    generateTraceId() {
        return randomUUID();
    }
    /**
     * Generate a new span ID
     */
    generateSpanId() {
        return randomUUID().replace(/-/g, "").slice(0, 16);
    }
    /**
     * Start a new span
     */
    startSpan(name, options) {
        const traceId = this.generateTraceId();
        const spanId = this.generateSpanId();
        const span = {
            name,
            traceId,
            spanId,
            parentSpanId: options?.parentSpanId,
            startTime: Date.now(),
            status: "ok",
            attributes: options?.attributes ?? {},
            events: [],
            links: options?.links ?? [],
        };
        const handle = new SpanHandle(this, span);
        this.currentSpan = handle;
        return handle;
    }
    /**
     * Get the current active span
     */
    getCurrentSpan() {
        return this.currentSpan ?? null;
    }
    /**
     * Record a completed span (called by SpanHandle)
     */
    recordCompletedSpan(span) {
        this.spans.push(span);
        // Export span based on configuration
        switch (this.config.exporter) {
            case "console":
                this.exportToConsole(span);
                break;
            case "otlp":
            case "jaeger":
                this.exportToOTLP(span);
                break;
        }
        // Clear current span if this was the current span
        if (this.currentSpan?.getSpan() === span) {
            this.currentSpan = undefined;
        }
    }
    /**
     * Export span to console
     */
    exportToConsole(span) {
        const duration = span.endTime
            ? span.endTime - span.startTime
            : Date.now() - span.startTime;
        const output = {
            service: this.config.serviceName,
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            status: span.status,
            durationMs: duration,
            attributes: span.attributes,
            events: span.events,
            timestamp: new Date(span.startTime).toISOString(),
        };
        if (span.status === "error") {
            console.error("[Tracer]", JSON.stringify(output));
        }
        else {
            console.log("[Tracer]", JSON.stringify(output));
        }
    }
    /**
     * Export span to OTLP/Jaeger
     */
    exportToOTLP(span) {
        // In a real implementation, this would send to OTLP endpoint
        if (this.config.endpoint) {
            this.logger.debug("Exporting span to OTLP", {
                endpoint: this.config.endpoint,
                traceId: span.traceId,
                spanId: span.spanId,
            });
        }
    }
    async trace(name, optionsOrFn, fn) {
        const spanOptions = typeof optionsOrFn === "function" ? undefined : optionsOrFn;
        const handler = typeof optionsOrFn === "function" ? optionsOrFn : fn;
        const span = this.startSpan(name, spanOptions);
        try {
            const result = await handler();
            span.end();
            return result;
        }
        catch (error) {
            if (error instanceof Error) {
                span.recordException(error);
            }
            span.end();
            throw error;
        }
    }
    traceSync(name, optionsOrFn, fn) {
        const spanOptions = typeof optionsOrFn === "function" ? undefined : optionsOrFn;
        const handler = typeof optionsOrFn === "function" ? optionsOrFn : fn;
        const span = this.startSpan(name, spanOptions);
        try {
            const result = handler();
            span.end();
            return result;
        }
        catch (error) {
            if (error instanceof Error) {
                span.recordException(error);
            }
            span.end();
            throw error;
        }
    }
    /**
     * Record an exception on the current span
     */
    recordException(error) {
        if (this.currentSpan) {
            this.currentSpan.recordException(error);
        }
    }
    /**
     * Add an event to the current span
     */
    addEvent(name, attributes) {
        if (this.currentSpan) {
            this.currentSpan.addEvent(name, attributes);
        }
    }
    /**
     * Get all recorded spans
     */
    getSpans() {
        return [...this.spans];
    }
    /**
     * Clear all recorded spans
     */
    clearSpans() {
        this.spans.length = 0;
    }
    /**
     * Export all spans
     */
    exportSpans() {
        return [...this.spans];
    }
    /**
     * Create a child tracer
     */
    childTracer(additionalConfig) {
        return new Tracer({
            ...this.config,
            ...additionalConfig,
        });
    }
}
// ─── Factory Function ────────────────────────────────────────────────────────
/**
 * Create a tracer with the given configuration
 */
export function createTracer(config) {
    return new Tracer(config);
}
//# sourceMappingURL=tracer.js.map