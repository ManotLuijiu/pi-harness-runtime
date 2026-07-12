/**
 * Telegram Adapter — RFC-0022
 *
 * Sends notifications via Telegram Bot API.
 */

import type {
	NotificationPayload,
	NotificationResult,
	TelegramConfig,
} from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";

export class TelegramAdapter extends BaseChannelAdapter {
	readonly id = "telegram";
	readonly type = "telegram";

	constructor(config: TelegramConfig) {
		super({ id: "telegram", type: "telegram", enabled: true, config });
	}

	async initialize(): Promise<boolean> {
		try {
			const cfg = this.config.config as TelegramConfig;
			// Verify bot token by calling getMe
			const response = await fetch(
				`https://api.telegram.org/bot${cfg.botToken}/getMe`,
			);
			return response.ok;
		} catch {
			return false;
		}
	}

	async send(payload: NotificationPayload): Promise<NotificationResult> {
		try {
			const cfg = this.config.config as TelegramConfig;
			const message = this.formatMessage(payload);

			const response = await fetch(
				`https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: cfg.chatId,
						text: message,
						parse_mode: cfg.parseMode ?? "MarkdownV2",
					}),
				},
			);

			if (!response.ok) {
				const error = await response.text();
				return {
					success: false,
					channel: this.id,
					error: `Telegram API error: ${error}`,
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
