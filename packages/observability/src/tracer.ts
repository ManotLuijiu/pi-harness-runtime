/**
 * Observability Package - Tracer
 *
 * Distributed tracing with OpenTelemetry-compatible interface.
 */

import { randomUUID } from "node:crypto";
import type {
	Span,
	SpanEvent,
	SpanStatus,
	StartSpanOptions,
	TracerConfig,
} from "./types.js";
import { Logger } from "./logger.js";

// ─── Span Handle ─────────────────────────────────────────────────────────────

export class SpanHandle {
	private readonly tracer: Tracer;
	private readonly span: Span;
	private ended = false;

	constructor(tracer: Tracer, span: Span) {
		this.tracer = tracer;
		this.span = span;
	}

	/**
	 * End the span
	 */
	end(): void {
		if (this.ended) return;
		this.ended = true;
		this.span.endTime = Date.now();
		this.tracer.recordCompletedSpan(this.span);
	}

	/**
	 * Set span status
	 */
	setStatus(status: SpanStatus): void {
		this.span.status = status;
	}

	/**
	 * Set an attribute
	 */
	setAttribute(key: string, value: string | number | boolean): void {
		this.span.attributes[key] = value;
	}

	/**
	 * Add an event to the span
	 */
	addEvent(
		name: string,
		attributes?: Record<string, string | number | boolean>,
	): void {
		const event: SpanEvent = {
			name,
			timestamp: Date.now(),
			attributes,
		};
		this.span.events.push(event);
	}

	/**
	 * Record an exception
	 */
	recordException(error: Error): void {
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
	getSpan(): Readonly<Span> {
		return this.span;
	}
}

// ─── Tracer Class ────────────────────────────────────────────────────────────

export class Tracer {
	private readonly config: TracerConfig;
	private readonly logger: Logger;
	private readonly spans: Span[] = [];
	private currentSpan?: SpanHandle;

	constructor(config: TracerConfig) {
		this.config = config;
		this.logger = new Logger({ level: config.logLevel ?? "warn" });
	}

	/**
	 * Generate a new trace ID
	 */
	private generateTraceId(): string {
		return randomUUID();
	}

	/**
	 * Generate a new span ID
	 */
	private generateSpanId(): string {
		return randomUUID().replace(/-/g, "").slice(0, 16);
	}

	/**
	 * Start a new span
	 */
	startSpan(name: string, options?: StartSpanOptions): SpanHandle {
		const traceId = this.generateTraceId();
		const spanId = this.generateSpanId();

		const span: Span = {
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
	getCurrentSpan(): SpanHandle | null {
		return this.currentSpan ?? null;
	}

	/**
	 * Record a completed span (called by SpanHandle)
	 */
	recordCompletedSpan(span: Span): void {
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
	private exportToConsole(span: Span): void {
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
		} else {
			console.log("[Tracer]", JSON.stringify(output));
		}
	}

	/**
	 * Export span to OTLP/Jaeger
	 */
	private exportToOTLP(span: Span): void {
		// In a real implementation, this would send to OTLP endpoint
		if (this.config.endpoint) {
			this.logger.debug("Exporting span to OTLP", {
				endpoint: this.config.endpoint,
				traceId: span.traceId,
				spanId: span.spanId,
			});
		}
	}

	/**
	 * Wrap an async function with tracing
	 */
	async trace<T>(name: string, fn: () => Promise<T>): Promise<T>;
	async trace<T>(
		name: string,
		options: StartSpanOptions,
		fn: () => Promise<T>,
	): Promise<T>;
	async trace<T>(
		name: string,
		optionsOrFn: StartSpanOptions | (() => Promise<T>),
		fn?: () => Promise<T>,
	): Promise<T> {
		const spanOptions: StartSpanOptions | undefined =
			typeof optionsOrFn === "function" ? undefined : optionsOrFn;
		const handler: () => Promise<T> =
			typeof optionsOrFn === "function" ? optionsOrFn : fn!;

		const span = this.startSpan(name, spanOptions);

		try {
			const result = await handler();
			span.end();
			return result;
		} catch (error) {
			if (error instanceof Error) {
				span.recordException(error);
			}
			span.end();
			throw error;
		}
	}

	/**
	 * Wrap a sync function with tracing
	 */
	traceSync<T>(name: string, fn: () => T): T;
	traceSync<T>(name: string, options: StartSpanOptions, fn: () => T): T;
	traceSync<T>(
		name: string,
		optionsOrFn: StartSpanOptions | (() => T),
		fn?: () => T,
	): T {
		const spanOptions: StartSpanOptions | undefined =
			typeof optionsOrFn === "function" ? undefined : optionsOrFn;
		const handler: () => T =
			typeof optionsOrFn === "function" ? optionsOrFn : fn!;

		const span = this.startSpan(name, spanOptions);

		try {
			const result = handler();
			span.end();
			return result;
		} catch (error) {
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
	recordException(error: Error): void {
		if (this.currentSpan) {
			this.currentSpan.recordException(error);
		}
	}

	/**
	 * Add an event to the current span
	 */
	addEvent(
		name: string,
		attributes?: Record<string, string | number | boolean>,
	): void {
		if (this.currentSpan) {
			this.currentSpan.addEvent(name, attributes);
		}
	}

	/**
	 * Get all recorded spans
	 */
	getSpans(): Readonly<Span>[] {
		return [...this.spans];
	}

	/**
	 * Clear all recorded spans
	 */
	clearSpans(): void {
		this.spans.length = 0;
	}

	/**
	 * Export all spans
	 */
	exportSpans(): Span[] {
		return [...this.spans];
	}

	/**
	 * Create a child tracer
	 */
	childTracer(additionalConfig: Partial<TracerConfig>): Tracer {
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
export function createTracer(config: TracerConfig): Tracer {
	return new Tracer(config);
}
