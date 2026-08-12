/**
 * LINE Adapter — RFC-0022
 *
 * Sends notifications via LINE Messaging API.
 */

import type {
	NotificationPayload,
	NotificationResult,
	LineConfig,
} from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";

export class LineAdapter extends BaseChannelAdapter {
	readonly id = "line";
	readonly type = "line";

	constructor(config: LineConfig) {
		super({ id: "line", type: "line", enabled: true, config });
	}

	async initialize(): Promise<boolean> {
		try {
			const cfg = this.config.config as LineConfig;
			// Verify access token by getting profile
			const response = await fetch(
				"https://api.line.me/v2/bot/profile",
				{
					headers: {
						Authorization: `Bearer ${cfg.channelAccessToken}`,
					},
				},
			);
			return response.ok;
		} catch {
			return false;
		}
	}

	async send(payload: NotificationPayload): Promise<NotificationResult> {
		try {
			const cfg = this.config.config as LineConfig;
			const message = this.formatMessage(payload);

			const response = await fetch(
				"https://api.line.me/v2/bot/message/push",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${cfg.channelAccessToken}`,
					},
					body: JSON.stringify({
						to: cfg.userId,
						messages: [
							{
								type: "text",
								text: message,
							},
						],
					}),
				},
			);

			if (!response.ok) {
				const error = await response.text();
				return {
					success: false,
					channel: this.id,
					error: `LINE API error: ${error}`,
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
		const emoji = this.getEmoji(payload.event);
		const title = `${emoji} ${payload.title}`;
		const lines = [title, "", payload.message];

		if (payload.details?.taskTitle) {
			lines.push("", `Task: ${payload.details.taskTitle}`);
		}
		if (payload.details?.jobId) {
			lines.push(`Job: ${payload.details.jobId}`);
		}
		if (payload.details?.error) {
			lines.push("", `Error: ${payload.details.error}`);
		}

		return lines.filter(Boolean).join("\n");
	}

	private getEmoji(event: NotificationPayload["event"]): string {
		const map: Record<string, string> = {
			JobStarted: "🚀",
			TaskCompleted: "✅",
			TaskFailed: "❌",
			QuotaPaused: "⏸️",
			ResumeScheduled: "▶️",
			ContextCompacted: "📦",
			OutputLimitContinued: "🔄",
			E2EFailed: "🧪",
			HumanReviewNeeded: "👤",
			ReadyForClient: "🎉",
			JobCancelled: "🚫",
			Error: "⚠️",
		};
		return map[event] ?? "📢";
	}
}
