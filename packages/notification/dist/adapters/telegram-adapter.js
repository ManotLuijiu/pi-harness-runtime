/**
 * Telegram Adapter — RFC-0022
 *
 * Sends notifications via Telegram Bot API.
 */
/// <reference types="node" />
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BaseChannelAdapter } from "../base-adapter.js";
import { maskString } from "../mask-secrets.js";
export class TelegramAdapter extends BaseChannelAdapter {
    id = "telegram";
    type = "telegram";
    _botUsername;
    _callbackHandler;
    _webhookSecret;
    constructor(config) {
        super({ id: "telegram", type: "telegram", enabled: true, config });
    }
    /**
     * Register a callback handler for inline keyboard button clicks
     */
    setCallbackHandler(handler) {
        this._callbackHandler = handler;
    }
    /**
     * Set webhook secret for verification
     */
    setWebhookSecret(secret) {
        this._webhookSecret = secret;
    }
    get botUsername() {
        return this._botUsername;
    }
    async initialize() {
        try {
            const cfg = this.config.config;
            const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getMe`);
            if (!response.ok)
                return false;
            const data = (await response.json());
            if (data.ok && data.result?.username) {
                this._botUsername = data.result.username;
            }
            return data.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Send a message with optional inline keyboard buttons
     */
    async send(payload) {
        try {
            const cfg = this.config.config;
            const message = this.formatMessage(payload);
            // Build request body
            const body = {
                chat_id: cfg.chatId,
                text: message,
                parse_mode: cfg.parseMode ?? "MarkdownV2",
            };
            // Add inline keyboard if enabled and buttons are configured
            if (cfg.enableInlineKeyboard && (cfg.actionButtons?.length ?? 0) > 0) {
                body.reply_markup = this.buildInlineKeyboard(cfg.actionButtons);
            }
            const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
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
    /**
     * Send a question that expects a text response from the user.
     * Writes response metadata to a file for polling.
     */
    async sendQuestion(payload, responseDir = "/tmp/pi-harness-responses") {
        try {
            const cfg = this.config.config;
            const message = this.formatMessage(payload);
            const body = {
                chat_id: cfg.chatId,
                text: message,
                parse_mode: cfg.parseMode ?? "MarkdownV2",
            };
            const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const error = await response.text();
                return {
                    success: false,
                    channel: this.id,
                    error: `Telegram API error: ${error}`,
                };
            }
            const resultData = (await response.json());
            const messageId = resultData.result?.message_id;
            // Write response marker file
            if (messageId) {
                if (!existsSync(responseDir)) {
                    mkdirSync(responseDir, { recursive: true });
                }
                writeFileSync(join(responseDir, `${payload.jobId}.json`), JSON.stringify({
                    status: "waiting",
                    messageId,
                    chatId: cfg.chatId,
                    expectedFormat: payload.details?.expectedFormat,
                    timestamp: new Date().toISOString(),
                }));
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
    /**
     * Build inline keyboard markup from button configuration
     */
    buildInlineKeyboard(buttons) {
        // Group buttons into rows of up to 3 buttons each (Telegram limit)
        const ROW_SIZE = 3;
        const rows = [];
        for (let i = 0; i < buttons.length; i += ROW_SIZE) {
            const row = buttons.slice(i, i + ROW_SIZE).map((btn) => ({
                text: btn.text,
                ...(btn.url ? { url: btn.url } : { callback_data: btn.callbackData }),
            }));
            rows.push(row);
        }
        return { inline_keyboard: rows };
    }
    /**
     * Process incoming webhook update from Telegram
     */
    async handleWebhookUpdate(update) {
        // Verify secret token if set
        if (this._webhookSecret) {
            const secretToken = update.secret_token;
            if (secretToken !== this._webhookSecret) {
                console.error("[TelegramAdapter] Invalid webhook secret");
                return;
            }
        }
        // Handle callback query (button click)
        const callbackQuery = update.callback_query;
        if (callbackQuery && this._callbackHandler) {
            const query = this.parseCallbackQuery(callbackQuery);
            if (query) {
                await this._callbackHandler(query.data, query);
                await this.answerCallbackQuery(query.id);
            }
        }
        // Handle regular messages (future: user can type commands)
        const message = update.message;
        if (message) {
            console.log("[TelegramAdapter] Received message:", message.text);
        }
    }
    /**
     * Parse callback query from webhook update
     */
    parseCallbackQuery(raw) {
        try {
            const from = raw.from;
            const message = raw.message;
            const chat = message?.chat;
            return {
                id: String(raw.id),
                from: {
                    id: Number(from?.id),
                    is_bot: Boolean(from?.is_bot),
                    first_name: String(from?.first_name ?? ""),
                    username: from?.username ? String(from.username) : undefined,
                },
                chat_instance: String(raw.chat_instance ?? ""),
                data: String(raw.data ?? ""),
                message: message
                    ? {
                        chat: { id: Number(chat?.id) },
                        message_id: Number(message?.message_id),
                    }
                    : undefined,
            };
        }
        catch {
            console.error("[TelegramAdapter] Failed to parse callback query");
            return null;
        }
    }
    /**
     * Answer a callback query to remove loading state
     */
    async answerCallbackQuery(callbackQueryId) {
        try {
            const cfg = this.config.config;
            await fetch(`https://api.telegram.org/bot${cfg.botToken}/answerCallbackQuery`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ callback_query_id: callbackQueryId }),
            });
        }
        catch (error) {
            console.error("[TelegramAdapter] Failed to answer callback query:", error);
        }
    }
    /**
     * Setup webhook for receiving updates
     */
    async setupWebhook(webhookUrl) {
        try {
            const cfg = this.config.config;
            const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/setWebhook`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: webhookUrl,
                    secret_token: this._webhookSecret,
                }),
            });
            if (!response.ok) {
                console.error("[TelegramAdapter] Webhook setup failed:", await response.text());
                return false;
            }
            console.log(`[TelegramAdapter] Webhook set to: ${webhookUrl}`);
            return true;
        }
        catch (error) {
            console.error("[TelegramAdapter] Webhook setup error:", error);
            return false;
        }
    }
    /**
     * Get current webhook info
     */
    async getWebhookInfo() {
        try {
            const cfg = this.config.config;
            const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getWebhookInfo`);
            if (!response.ok)
                return null;
            return (await response.json());
        }
        catch {
            return null;
        }
    }
    formatMessage(payload) {
        // Mask all fields before rendering - defense in depth
        const maskedTitle = maskString(payload.title);
        const maskedMessage = maskString(payload.message);
        const taskTitle = payload.details?.taskTitle;
        const jobId = payload.details?.jobId;
        const errorVal = payload.details?.error;
        const maskedTaskTitle = typeof taskTitle === "string" ? maskString(taskTitle) : undefined;
        const maskedJobId = typeof jobId === "string" ? maskString(jobId) : undefined;
        const maskedError = typeof errorVal === "string" ? maskString(errorVal) : undefined;
        const emoji = this.getEmoji(payload.event);
        const title = `${emoji} ${maskedTitle}`;
        const lines = [title, "", maskedMessage];
        if (maskedTaskTitle) {
            lines.push("", `Task: ${maskedTaskTitle}`);
        }
        if (maskedJobId) {
            lines.push(`Job: ${maskedJobId}`);
        }
        if (maskedError) {
            lines.push("", `Error: ${maskedError}`);
        }
        // Final mask pass on the complete rendered string
        return maskString(lines.filter(Boolean).join("\n"));
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
//# sourceMappingURL=telegram-adapter.js.map