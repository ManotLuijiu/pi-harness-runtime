/**
 * Notification Base Adapter — RFC-0022
 *
 * Abstract base class for all notification channel adapters.
 */

import type {
	NotificationPayload,
	NotificationChannelConfig,
	NotificationResult,
} from "./types.js";

export interface ChannelAdapter {
	readonly id: string;
	readonly type: string;

	/**
	 * Initialize the adapter (e.g., verify credentials)
	 */
	initialize(): Promise<boolean>;

	/**
	 * Send a notification
	 */
	send(payload: NotificationPayload): Promise<NotificationResult>;

	/**
	 * Check if the adapter is properly configured
	 */
	isConfigured(): boolean;

	/**
	 * Check if the adapter is healthy (initialized and working)
	 * Returns true if initialized successfully, false otherwise
	 */
	isHealthy(): boolean;

	/**
	 * Why the adapter is not healthy (null when it is healthy or when the
	 * adapter has nothing to say).
	 *
	 * The message must be safe to show to a user: no token, no credential,
	 * no raw response body that could echo one back.
	 */
	getDiagnostic?(): string | null;
}

	export abstract class BaseChannelAdapter implements ChannelAdapter {
	protected _healthy = false;
	protected _diagnostic: string | null = null;

	abstract readonly id: string;
	abstract readonly type: string;

	constructor(protected config: NotificationChannelConfig) {}

	abstract initialize(): Promise<boolean>;
	abstract send(payload: NotificationPayload): Promise<NotificationResult>;

	isConfigured(): boolean {
		return this.config.enabled;
	}

	/**
	 * Default health check - subclasses should override for actual health verification
	 */
	isHealthy(): boolean {
		return this._healthy;
	}

	/**
	 * Mark adapter as healthy (called after successful initialize)
	 */
	protected markHealthy(): void {
		this._healthy = true;
		this._diagnostic = null;
	}

	/**
	 * Record why the adapter is not healthy.
	 *
	 * The reason is what the startup summary shows, so it must be short and
	 * must never contain a credential.
	 */
	protected setDiagnostic(reason: string | null): void {
		this._diagnostic = reason;
	}

	/**
	 * Why the adapter is not healthy (null when healthy).
	 */
	getDiagnostic(): string | null {
		return this._healthy ? null : this._diagnostic;
	}

	/**
	 * Redact sensitive data from payload before sending
	 */
	protected redact(
		payload: NotificationPayload,
		patterns: RegExp[],
	): NotificationPayload {
		if (patterns.length === 0) return payload;

		const redacted: string[] = [];
		const details = payload.details ? { ...payload.details } : {};

		for (const [key, value] of Object.entries(details)) {
			const valStr = String(value);
			for (const pattern of patterns) {
				if (pattern.test(valStr)) {
					redacted.push(key);
					(details as Record<string, unknown>)[key] = "[REDACTED]";
					break;
				}
			}
		}

		return {
			...payload,
			details,
			redacted: redacted.length > 0 ? redacted : undefined,
		};
	}
}
