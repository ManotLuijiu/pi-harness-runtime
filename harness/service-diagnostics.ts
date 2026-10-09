/**
 * Service Diagnostics - Structured logging for harness services
 *
 * Logs service events to ~/.pi-harness-runtime/logs/services.jsonl
 * with structured data for observability.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ServiceLevel = "info" | "warn" | "error" | "debug";
export type ServiceName = "jev" | "honcho" | "qdrant";

export interface ServiceEvent {
	ts: string;
	level: ServiceLevel;
	service: ServiceName;
	operation: string;
	phase: "start" | "completed" | "failed";
	sessionId?: string;
	requestId?: string;
	durationMs?: number;
	[key: string]: unknown;
}

const LOG_DIR = join(homedir(), ".pi-harness-runtime", "logs");
const LOG_FILE = join(LOG_DIR, "services.jsonl");
let _initialized = false;

function ensureLogDir(): void {
	if (_initialized) return;
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true });
	}
	_initialized = true;
}

/**
 * Log a structured service event.
 * Sensitive fields (keys, tokens, full content) are never logged.
 */
export function logServiceEvent(event: ServiceEvent): void {
	ensureLogDir();

	// Redact sensitive fields
	const safeEvent = redactSensitive(event);

	try {
		appendFileSync(LOG_FILE, JSON.stringify(safeEvent) + "\n");
	} catch {
		// Silently fail if logging fails - don't crash the service
	}
}

/**
 * Redact sensitive fields from event data.
 * Never log: apiKey, token, secret, chatId, content, vectors, embeddings
 */
function redactSensitive(event: ServiceEvent): Record<string, unknown> {
	const sensitiveKeys = [
		"apiKey",
		"token",
		"secret",
		"bearerToken",
		"chatId",
		"content",
		"vectors",
		"embeddings",
		"prompt",
		"messages",
		"raw",
	];

	const result: Record<string, unknown> = { ...event };

	for (const key of Object.keys(result)) {
		if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
			result[key] = "[REDACTED]";
		}
	}

	return result;
}

/**
 * Create a service status tracker.
 */
export class ServiceStatus {
	private _configured = false;
	private _initialized = false;
	private _connected = false;
	private _lastSuccessAt: string | null = null;
	private _lastFailureAt: string | null = null;
	private _lastErrorCode: string | null = null;
	private _requests = 0;
	private _successes = 0;
	private _failures = 0;
	private _featureEnabled = false;
	private _service: ServiceName;

	constructor(service: ServiceName) {
		this._service = service;
	}

	get configured() { return this._configured; }
	get initialized() { return this._initialized; }
	get connected() { return this._connected; }
	get lastSuccessAt() { return this._lastSuccessAt; }
	get lastFailureAt() { return this._lastFailureAt; }
	get lastErrorCode() { return this._lastErrorCode; }
	get requests() { return this._requests; }
	get successes() { return this._successes; }
	get failures() { return this._failures; }
	get featureEnabled() { return this._featureEnabled; }

	setConfigured(v: boolean): this {
		this._configured = v;
		logServiceEvent({
			ts: new Date().toISOString(),
			level: "info",
			service: this._service,
			operation: "config_checked",
			phase: "completed",
			configured: v,
		});
		return this;
	}

	setInitialized(v: boolean): this {
		this._initialized = v;
		if (v) {
			logServiceEvent({
				ts: new Date().toISOString(),
				level: "info",
				service: this._service,
				operation: "initialized",
				phase: "completed",
			});
		}
		return this;
	}

	setConnected(v: boolean): this {
		this._connected = v;
		logServiceEvent({
			ts: new Date().toISOString(),
			level: "info",
			service: this._service,
			operation: "connected",
			phase: v ? "completed" : "failed",
			connected: v,
		});
		return this;
	}

	setFeatureEnabled(v: boolean): this {
		this._featureEnabled = v;
		return this;
	}

	recordSuccess(operation: string, durationMs?: number, extra?: Record<string, unknown>): void {
		this._requests++;
		this._successes++;
		this._lastSuccessAt = new Date().toISOString();
		logServiceEvent({
			ts: new Date().toISOString(),
			level: "info",
			service: this._service,
			operation,
			phase: "completed",
			durationMs,
			requests: this._requests,
			successes: this._successes,
			...extra,
		});
	}

	recordFailure(operation: string, errorCode: string, extra?: Record<string, unknown>): void {
		this._requests++;
		this._failures++;
		this._lastFailureAt = new Date().toISOString();
		this._lastErrorCode = errorCode;
		logServiceEvent({
			ts: new Date().toISOString(),
			level: "error",
			service: this._service,
			operation,
			phase: "failed",
			errorCode,
			requests: this._requests,
			failures: this._failures,
			...extra,
		});
	}

	toJSON(): Record<string, unknown> {
		return {
			service: this._service,
			configured: this._configured,
			initialized: this._initialized,
			connected: this._connected,
			lastSuccessAt: this._lastSuccessAt,
			lastFailureAt: this._lastFailureAt,
			lastErrorCode: this._lastErrorCode,
			requests: this._requests,
			successes: this._successes,
			failures: this._failures,
			featureEnabled: this._featureEnabled,
		};
	}
}

// Export service status instances
export const jevStatus = new ServiceStatus("jev");
export const honchoStatus = new ServiceStatus("honcho");
export const qdrantStatus = new ServiceStatus("qdrant");
