/**
 * Telegram Adapter — RFC-0022
 *
 * Sends notifications via Telegram Bot API.
 */
import { BaseChannelAdapter } from "../base-adapter.ts";
export class TelegramAdapter extends BaseChannelAdapter {
    id = "telegram";
    type = "telegram";
    constructor(config) {
        super({ id: "telegram", type: "telegram", enabled: true, config });
    }
    async initialize() {
        try {
            const cfg = this.config.config;
            // Verify bot token by calling getMe
            const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getMe`);
            return response.ok;
        }
        catch {
            return false;
        }
    }
    async send(payload) {
        try {
            const cfg = this.config.config;
            const message = this.formatMessage(payload);
            const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: cfg.chatId,
                    text: message,
                    parse_mode: cfg.parseMode ?? "MarkdownV2",
                }),
            });
            if (!response.ok) {
                const error = await response.text();
                return {
                    success: false,
                    channel: this.id,
                    error: `Telegram API error: ${error}`,
                };
            }
            return { success: true, channel: this.id };
        }
        catch (error) {
            return {
                success: false,
                channel: this.id,
                error: String(error),
            };
        }
    }
    formatMessage(payload) {
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
    getEmoji(event) {
        const map = {
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
