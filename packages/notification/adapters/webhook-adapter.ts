/**
 * Webhook Adapter — RFC-0022
 *
 * Sends notifications to a generic webhook endpoint.
 */

import type {
	NotificationPayload,
	NotificationResult,
	WebhookConfig,
} from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";

export class WebhookAdapter extends BaseChannelAdapter {
	readonly id = "webhook";
	readonly type = "webhook";

	constructor(config: WebhookConfig) {
		super({ id: "webhook", type: "webhook", enabled: true, config });
	}

	async initialize(): Promise<boolean> {
		try {
			const cfg = this.config.config as WebhookConfig;
			return Boolean(cfg.url && cfg.url.startsWith("http"));
		} catch {
			return false;
		}
	}

	async send(payload: NotificationPayload): Promise<NotificationResult> {
		try {
			const cfg = this.config.config as WebhookConfig;
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				...(cfg.headers ?? {}),
			};

			// Add auth token if configured
			if (cfg.authToken) {
				headers["Authorization"] = `Bearer ${cfg.authToken}`;
			}

			const response = await fetch(cfg.url, {
				method: cfg.method ?? "POST",
				headers,
				body: JSON.stringify({
					event: payload.event,
					jobId: payload.jobId,
					timestamp: payload.timestamp,
					title: payload.title,
					message: payload.message,
					details: payload.details,
				}),
			});

			if (!response.ok) {
				const error = await response.text();
				return {
					success: false,
					channel: this.id,
					error: `Webhook error ${response.status}: ${error}`,
				};
			}

			return { success: true, channel: this.id };
		} catch (error) {
			return {
				success: false,
				channel: this.id,
				error: String(error),
			};
		}
	}
}
