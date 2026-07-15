/**
 * Ntfy Adapter — RFC-0022
 *
 * Sends notifications via ntfy.sh (or self-hosted ntfy server).
 */

import type {
	NotificationPayload,
	NotificationResult,
	NtfyConfig,
} from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";

export class NtfyAdapter extends BaseChannelAdapter {
	readonly id = "ntfy";
	readonly type = "ntfy";

	constructor(config: NtfyConfig) {
		super({ id: "ntfy", type: "ntfy", enabled: true, config });
	}

	async initialize(): Promise<boolean> {
		// Ntfy doesn't require initialization; it's fire-and-forget
		return true;
	}

	async send(payload: NotificationPayload): Promise<NotificationResult> {
		try {
			const cfg = this.config.config as NtfyConfig;
			const message = this.formatMessage(payload);
			const headers: Record<string, string> = {
				"Content-Type": "text/plain",
				Title: payload.title,
				Tags: this.getTags(payload.event),
			};

			// Add auth if configured
			if (cfg.authToken) {
				headers["Authorization"] = `Bearer ${cfg.authToken}`;
			}

			const response = await fetch(`${cfg.server}/${cfg.topic}`, {
				method: "POST",
				headers,
				body: message,
			});

			if (!response.ok) {
				const error = await response.text();
				return {
					success: false,
					channel: this.id,
					error: `Ntfy error: ${error}`,
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

	private formatMessage(payload: NotificationPayload): string {
		const lines = [payload.message];

		if (payload.details?.taskTitle) {
			lines.push(`\nTask: ${payload.details.taskTitle}`);
		}
		if (payload.details?.jobId) {
			lines.push(`Job: ${payload.details.jobId}`);
		}
		if (payload.details?.error) {
			lines.push(`\nError: ${payload.details.error}`);
		}

		return lines.join("");
	}

	private getTags(event: NotificationPayload["event"]): string {
		const map: Record<string, string> = {
			JobStarted: "rocket",
			TaskCompleted: "white_check_mark",
			TaskFailed: "x",
			QuotaPaused: "pause_button",
			ResumeScheduled: "play_button",
			ContextCompacted: "package",
			OutputLimitContinued: "repeat",
			E2EFailed: "test_tube",
			HumanReviewNeeded: "bust_in_silhouette",
			ReadyForClient: "tada",
			JobCancelled: "no_entry",
			Error: "warning",
		};
		return map[event] ?? "bell";
	}
}
