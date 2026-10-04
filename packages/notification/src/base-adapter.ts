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
}

export abstract class BaseChannelAdapter implements ChannelAdapter {
	abstract readonly id: string;
	abstract readonly type: string;

	constructor(protected config: NotificationChannelConfig) {}

	abstract initialize(): Promise<boolean>;
	abstract send(payload: NotificationPayload): Promise<NotificationResult>;

	isConfigured(): boolean {
		return this.config.enabled;
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
