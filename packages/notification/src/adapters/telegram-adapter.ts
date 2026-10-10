/**
 * Telegram Adapter — RFC-0022
 *
 * Sends notifications via Telegram Bot API.
 */

/// <reference types="node" />

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
	InlineKeyboardButton,
	NotificationPayload,
	NotificationResult,
	TelegramCallbackHandler,
	TelegramCallbackQuery,
	TelegramConfig,
} from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";
import { maskString } from "../mask-secrets.js";
import { filterTelegramContent, getSafeNotificationLog } from "../telegram-content-filter.js";

export class TelegramAdapter extends BaseChannelAdapter {
readonly id = "telegram";
readonly type = "telegram";
private _botUsername: string | undefined;
private _callbackHandler: TelegramCallbackHandler | undefined;
private _webhookSecret: string | undefined;

constructor(config: TelegramConfig) {
super({ id: "telegram", type: "telegram", enabled: true, config });
}

/**
 * Register a callback handler for inline keyboard button clicks
 */
setCallbackHandler(handler: TelegramCallbackHandler): void {
	this._callbackHandler = handler;
}

/**
 * Set webhook secret for verification
 */
setWebhookSecret(secret: string): void {
	this._webhookSecret = secret;
}

get botUsername(): string | undefined {
return this._botUsername;
}

	async initialize(): Promise<boolean> {
		try {
			const cfg = this.config.config as TelegramConfig;
			const response = await fetch(
				`https://api.telegram.org/bot${cfg.botToken}/getMe`,
			);
			if (!response.ok) return false;
			const data = (await response.json()) as { ok: boolean; result?: { username?: string } };
			if (data.ok && data.result?.username) {
				this._botUsername = data.result.username;
			}
			return data.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Send a message with optional inline keyboard buttons
	 */
	async send(payload: NotificationPayload): Promise<NotificationResult> {
		try {
			// SECURITY: Jev-powered content filter - block if contains sensitive credentials
			const filterResult = await filterTelegramContent(payload);
			if (!filterResult.shouldSend) {
				console.warn(
					`[TelegramAdapter] BLOCKED by Jev judgment=${filterResult.judgment} reason=${filterResult.reason} job=${payload.jobId}`,
				);
				// Log safe notification metadata (no secrets)
				console.log(`[TelegramAdapter] ${getSafeNotificationLog(payload)}`);
				return {
					success: false,
					channel: this.id,
					error: "Content blocked: sensitive credentials detected",
				};
			}

			const cfg = this.config.config as TelegramConfig;
			const message = this.formatMessage(payload);

			// Build request body
			// Use plain text by default to avoid MarkdownV2 escaping issues with dynamic content
			// If parseMode is explicitly set, use it (caller is responsible for escaping)
			const body: Record<string, unknown> = {
				chat_id: cfg.chatId,
				text: message,
			};

			// Only add parse_mode if explicitly configured
			if (cfg.parseMode) {
				body.parse_mode = cfg.parseMode;
			}

			// Read buttons from payload.details (set by notifyWithApproval)
			const enableInlineKeyboard = (payload.details?._enableInlineKeyboard as boolean) ?? cfg.enableInlineKeyboard;
			const actionButtons = (payload.details?._actionButtons as InlineKeyboardButton[]) ?? cfg.actionButtons;

			// Add inline keyboard if enabled and buttons are configured
			if (enableInlineKeyboard && (actionButtons?.length ?? 0) > 0) {
				body.reply_markup = this.buildInlineKeyboard(actionButtons);
			}

			const response = await fetch(
				`https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
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

	/**
	 * Send a question that expects a text response from the user.
	 * Writes response metadata to a file for polling.
	 */
	async sendQuestion(
		payload: NotificationPayload,
		responseDir = "/tmp/pi-harness-responses",
	): Promise<NotificationResult> {
		try {
			const cfg = this.config.config as TelegramConfig;
			const message = this.formatMessage(payload);

			const body: Record<string, unknown> = {
				chat_id: cfg.chatId,
				text: message,
			};

			// Only add parse_mode if explicitly configured
			if (cfg.parseMode) {
				body.parse_mode = cfg.parseMode;
			}

			const response = await fetch(
				`https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
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

			const resultData = (await response.json()) as {
				result?: { message_id?: number };
			};
			const messageId = resultData.result?.message_id;

			// Write response marker file
			if (messageId) {
				if (!existsSync(responseDir)) {
					mkdirSync(responseDir, { recursive: true });
				}
				writeFileSync(
					join(responseDir, `${payload.jobId}.json`),
					JSON.stringify({
						status: "waiting",
						messageId,
						chatId: cfg.chatId,
						expectedFormat: payload.details?.expectedFormat,
						timestamp: new Date().toISOString(),
					}),
				);
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

	/**
	 * Build inline keyboard markup from button configuration
	 */
	private buildInlineKeyboard(
		buttons: InlineKeyboardButton[],
	): { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> } {
		// Group buttons into rows of up to 3 buttons each (Telegram limit)
		const ROW_SIZE = 3;
		const rows: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [];

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
	async handleWebhookUpdate(update: Record<string, unknown>): Promise<void> {
		// Verify secret token if set
		if (this._webhookSecret) {
			const secretToken = (update as { secret_token?: string }).secret_token;
			if (secretToken !== this._webhookSecret) {
				console.error("[TelegramAdapter] Invalid webhook secret");
				return;
			}
		}

		// Handle callback query (button click)
		const callbackQuery = update.callback_query as Record<string, unknown> | undefined;
		if (callbackQuery && this._callbackHandler) {
			const query = this.parseCallbackQuery(callbackQuery);
			if (query) {
				await this._callbackHandler(query.data, query);
				await this.answerCallbackQuery(query.id);
			}
		}

		// Handle regular messages (future: user can type commands)
		const message = update.message as Record<string, unknown> | undefined;
		if (message) {
			console.log("[TelegramAdapter] Received message:", message.text);
		}
	}

	/**
	 * Parse callback query from webhook update
	 */
	private parseCallbackQuery(
		raw: Record<string, unknown>,
	): TelegramCallbackQuery | null {
		try {
			const from = raw.from as Record<string, unknown>;
			const message = raw.message as Record<string, unknown> | undefined;
			const chat = message?.chat as Record<string, unknown> | undefined;

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
		} catch {
			console.error("[TelegramAdapter] Failed to parse callback query");
			return null;
		}
	}

	/**
	 * Answer a callback query to remove loading state
	 */
	private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
		try {
			const cfg = this.config.config as TelegramConfig;
			await fetch(
				`https://api.telegram.org/bot${cfg.botToken}/answerCallbackQuery`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ callback_query_id: callbackQueryId }),
				},
			);
		} catch (error) {
			console.error("[TelegramAdapter] Failed to answer callback query:", error);
		}
	}

	/**
	 * Setup webhook for receiving updates
	 */
	async setupWebhook(webhookUrl: string): Promise<boolean> {
		try {
			const cfg = this.config.config as TelegramConfig;
			const response = await fetch(
				`https://api.telegram.org/bot${cfg.botToken}/setWebhook`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						url: webhookUrl,
						secret_token: this._webhookSecret,
					}),
				},
			);

			if (!response.ok) {
				console.error("[TelegramAdapter] Webhook setup failed:", await response.text());
				return false;
			}

			console.log(`[TelegramAdapter] Webhook set to: ${webhookUrl}`);
			return true;
		} catch (error) {
			console.error("[TelegramAdapter] Webhook setup error:", error);
			return false;
		}
	}

	/**
	 * Get current webhook info
	 */
	async getWebhookInfo(): Promise<Record<string, unknown> | null> {
		try {
			const cfg = this.config.config as TelegramConfig;
			const response = await fetch(
				`https://api.telegram.org/bot${cfg.botToken}/getWebhookInfo`,
			);

			if (!response.ok) return null;
			return (await response.json()) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	private formatMessage(payload: NotificationPayload): string {
		// Mask all fields before rendering - defense in depth
		const maskedTitle = maskString(payload.title);
		const maskedMessage = maskString(payload.message);
		const taskTitle = payload.details?.taskTitle;
		const jobId = payload.details?.jobId;
		const errorVal = payload.details?.error;

		const maskedTaskTitle = typeof taskTitle === "string" ? maskString(taskTitle) : undefined;
		const maskedJobId = typeof jobId === "string" ? maskString(jobId) : undefined;
		const maskedError = typeof errorVal === "string" ? maskString(errorVal) : undefined;

		const label = this.getStatusLabel(payload.event);
		const title = `${label} ${maskedTitle}`;
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

	private getStatusLabel(event: NotificationPayload["event"]): string {
		// Use ASCII labels per AGENTS.md convention
		// Avoid emoji which renders inconsistently across terminals
		const labels: Record<string, string> = {
			JobStarted: "[START]",
			TaskCompleted: "[OK]",
			TaskFailed: "[FAIL]",
			QuotaPaused: "[PAUSE]",
			ResumeScheduled: "[RESUME]",
			ContextCompacted: "[COMPACT]",
			OutputLimitContinued: "[CONTINUE]",
			E2EFailed: "[TEST]",
			HumanReviewNeeded: "[REVIEW]",
			ReadyForClient: "[DONE]",
			JobCancelled: "[CANCEL]",
			Error: "[ERROR]",
		};
		return labels[event] ?? "[MSG]";
	}
}
