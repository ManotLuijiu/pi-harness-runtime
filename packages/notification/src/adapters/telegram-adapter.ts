/**
 * Telegram Adapter — RFC-0022
 *
 * Sends notifications via Telegram Bot API.
 */

/// <reference types="node" />

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { logError, logInfo, logWarn } from "../file-logger.js";

import type {
	InlineKeyboardButton,
	NotificationPayload,
	NotificationResult,
	TelegramCallbackHandler,
	TelegramCallbackQuery,
	TelegramConfig,
} from "../types.js";

/**
 * Telegram update object from getUpdates
 */
// Handler for inbound Telegram messages (forwarded to Pi)
type TelegramMessageHandler = (text: string, chatId: string) => Promise<void>;

interface TelegramUpdate {
	update_id: number;
	callback_query?: TelegramCallbackQuery;
	message?: {
		message_id?: number;
		chat?: { id?: number; type?: string };
		text?: string;
		from?: { id?: number; is_bot?: boolean };
	};
}
import { BaseChannelAdapter } from "../base-adapter.js";
import { maskString } from "../mask-secrets.js";
import { filterTelegramContent, getSafeNotificationLog } from "../telegram-content-filter.js";

export class TelegramAdapter extends BaseChannelAdapter {
readonly id = "telegram";
readonly type = "telegram";
private _botUsername: string | undefined;
private _callbackHandler: TelegramCallbackHandler | undefined;
private _messageHandler: TelegramMessageHandler | undefined;
private _webhookSecret: string | undefined;
	private _webhookActive = false;
private _pollInterval: ReturnType<typeof setInterval> | undefined;
private _lastUpdateId: number = -1;
private _pollTimeoutMs = 30000; // Long polling timeout
private _pollLimit = 10;
private _pollInFlight = false;
private _pollAbort: AbortController | undefined;
private _greetingToken: string | undefined;
private _greetingMessageId: number | undefined;
private _greetingVerified = false;
private _greetingReplyInFlight = false;
private _greetingHandler: (() => void) | undefined;

setGreetingVerifiedHandler(handler: () => void): void {
	this._greetingHandler = handler;
}

isGreetingVerified(): boolean {
	return this._greetingVerified;
}

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
 * Register a message handler for inbound Telegram messages
 */
setMessageHandler(handler: TelegramMessageHandler): void {
	this._messageHandler = handler;
}

/**
 * Set webhook secret for verification
 */
		setWebhookSecret(secret: string): void {
			this._webhookSecret = secret;
		}

		/**
		 * Mark webhook as active (called by webhook setup)
		 */
		setWebhookActive(active: boolean): void {
			this._webhookActive = active;
			if (active && this._pollInterval) {
				logInfo("[TelegramAdapter]", "Stopping polling - webhook now active");
				clearInterval(this._pollInterval);
				this._pollInterval = undefined;
			}
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
			if (!response.ok) {
				logWarn("[TelegramAdapter]", `getMe failed: HTTP ${response.status}`);
				return false;
			}
			const data = (await response.json()) as { ok: boolean; result?: { username?: string } };
			if (!data.ok || !data.result?.username) {
				logWarn("[TelegramAdapter]", "getMe returned ok=false");
				return false;
			}

			this._botUsername = data.result.username;
			this.markHealthy(); // Mark as healthy after successful getMe
			logInfo("[TelegramAdapter]", `Bot @${this._botUsername} verified successfully`);

			// Start polling ONLY if webhook is not configured (separate server handles webhooks)
			if (this._callbackHandler) {
				// Check if webhook URL file exists (webhook server handles updates)
				const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
				const webhookUrlPath = join(homedir, ".pi-harness-runtime", "keys", "telegram-webhook-url.txt");
				const hasWebhook = existsSync(webhookUrlPath);
				if (hasWebhook) {
					logInfo("[TelegramAdapter]", "Webhook configured (separate server), skipping polling");
				} else {
					this.startPolling();
				}
			}

			return true;
		} catch (err) {
			logError("[TelegramAdapter] Initialize failed", err);
			return false;
		}
	}

	/**
	 * Start polling for Telegram updates (callback queries, etc.)
	 */
	startPolling(): void {
		if (this._pollInterval) return; // Already polling

		logInfo("[TelegramAdapter]", "Starting polling for callback queries...");

		// Poll immediately, then on interval
		this.poll().catch((err) => logError("[TelegramAdapter] Poll error", err));

		this._pollInterval = setInterval(() => {
			this.poll().catch((err) => logError("[TelegramAdapter] Poll error", err));
		}, 5000); // Poll every 5 seconds
	}

	/**
	 * Stop polling
	 */
	stopPolling(): void {
		this._pollAbort?.abort();
		if (this._pollInterval) {
			clearInterval(this._pollInterval);
			this._pollInterval = undefined;
			logInfo("[TelegramAdapter]", "Stopped polling");
		}
	}

	/**
	 * Poll for updates using getUpdates
	 */
	private async poll(): Promise<void> {
		if (this._pollInFlight) return;
		this._pollInFlight = true;
		const abort = new AbortController();
		this._pollAbort = abort;
		const cfg = this.config.config as TelegramConfig;
		const token = cfg.botToken;

		try {
			const body: Record<string, unknown> = {
				offset: this._lastUpdateId + 1,
				limit: this._pollLimit,
				timeout: Math.floor(this._pollTimeoutMs / 1000),
				allowed_updates: ["callback_query", "message"],  // Poll for both callbacks AND messages
			};

			const response = await fetch(
				`https://api.telegram.org/bot${token}/getUpdates`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
					signal: AbortSignal.any([abort.signal, AbortSignal.timeout(this._pollTimeoutMs + 5000)]),
				},
			);

			if (!response.ok) {
				const error = await response.text();
				logWarn("[TelegramAdapter]", `getUpdates failed: ${error}`);
				return;
			}

			const data = (await response.json()) as {
				ok: boolean;
				result?: TelegramUpdate[];
			};

			if (!data.ok || !data.result?.length) return;

			// Process updates
			for (const update of data.result) {
				if (abort.signal.aborted) break;
				await this.processUpdate(update);
				this._lastUpdateId = update.update_id;
			}
		} catch (err) {
			if (abort.signal.aborted) return;
			if (err instanceof Error && err.name === "TimeoutError") {
				// Timeout is expected for long polling, not an error
				return;
			}
			logError("[TelegramAdapter] Poll error", err);
		} finally {
			this._pollInFlight = false;
			if (this._pollAbort === abort) this._pollAbort = undefined;
		}
	}

	/**
	 * Process a single Telegram update
	 */
	private async processUpdate(update: TelegramUpdate): Promise<void> {
		const cfg = this.config.config as TelegramConfig;

		// Handle callback query
		if (update.callback_query) {
			const query = update.callback_query;
			if (String(query.message?.chat.id) !== String(cfg.chatId) || query.from?.is_bot) return;
			logInfo(
				"[TelegramAdapter]",
				`Callback query: ${query.data} from user ${query.from?.id}`,
			);

			// NOTE: Acknowledgment is now controlled by the handler via acknowledgeCallback()
			// This allows the handler to validate before dismissing the loading indicator

			if (await this.handleGreetingReply(query)) return;

			// Call the registered handler - handler calls acknowledgeCallback() after validation
			if (this._callbackHandler && query.data) {
					await this._callbackHandler(query.data, query, (msg) => this.acknowledgeCallback(query.id, msg));
			}
		}

		// Handle regular message
		if (update.message && this._messageHandler) {
			const msg = update.message;
			// Only forward text messages from non-bot users
			if (msg.text && (!msg.from || !msg.from.is_bot)) {
				const chatId = msg.chat?.id?.toString() || "";
				if (chatId !== String(cfg.chatId)) return;
				await this._messageHandler(msg.text, chatId);
			}
		}
	}

	/**
	 * Verify outbound delivery with a fixed startup greeting. No user content is sent.
	 */
	async sendStartupGreeting(): Promise<NotificationResult> {
		const cfg = this.config.config as TelegramConfig;
		this._greetingToken = `hi:${randomUUID()}`;
		this._greetingMessageId = undefined;
		this._greetingVerified = false;
		try {
			const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: cfg.chatId,
					text: `[${hostname()}] Hi! Tap Say Hi back to test two-way communication.`,
					reply_markup: { inline_keyboard: [[{ text: "Say Hi back", callback_data: this._greetingToken }]] },
				}),
				signal: AbortSignal.timeout(10000),
			});
			const data = await response.json() as { ok?: boolean; result?: { message_id?: number } };
			if (!response.ok || data.ok !== true || typeof data.result?.message_id !== "number") {
				return { success: false, channel: this.id, error: `Telegram greeting rejected (HTTP ${response.status})` };
			}
			this._greetingMessageId = data.result.message_id;
			return { success: true, channel: this.id };
		} catch {
			// Network errors can contain the token-bearing URL. Never expose them.
			return { success: false, channel: this.id, error: "Telegram greeting failed or timed out" };
		}
	}

	/** A greeting callback is a transport check, not new agent work or approval. */
	private async handleGreetingReply(query: TelegramCallbackQuery): Promise<boolean> {
		// DEBUG: Log all incoming callback data
		logInfo("[TelegramAdapter][DEBUG]", `handleGreetingReply called`);
		logInfo("[TelegramAdapter][DEBUG]", `  query.data: ${query.data}`);
		logInfo("[TelegramAdapter][DEBUG]", `  query.id: ${query.id}`);
		logInfo("[TelegramAdapter][DEBUG]", `  query.from?.id: ${query.from?.id}`);
		logInfo("[TelegramAdapter][DEBUG]", `  query.message?.message_id: ${query.message?.message_id}`);
		logInfo("[TelegramAdapter][DEBUG]", `  query.message?.chat?.id: ${query.message?.chat?.id}`);

		if (!query.data?.startsWith("hi:")) {
			logInfo("[TelegramAdapter][DEBUG]", `  -> Not a greeting callback (data doesn't start with 'hi:')`);
			return false;
		}

		const cfg = this.config.config as TelegramConfig;
		logInfo("[TelegramAdapter][DEBUG]", `  this._greetingToken: ${this._greetingToken}`);
		logInfo("[TelegramAdapter][DEBUG]", `  this._greetingMessageId: ${this._greetingMessageId}`);
		logInfo("[TelegramAdapter][DEBUG]", `  this._greetingVerified: ${this._greetingVerified}`);
		logInfo("[TelegramAdapter][DEBUG]", `  this._greetingReplyInFlight: ${this._greetingReplyInFlight}`);
		logInfo("[TelegramAdapter][DEBUG]", `  cfg.chatId: ${cfg.chatId}`);

		// Check all conditions
		const checks = {
			dataMatches: query.data === this._greetingToken,
			messageIdMatches: query.message?.message_id === this._greetingMessageId,
			chatIdMatches: String(query.message?.chat?.id) === String(cfg.chatId),
			notBot: !query.from?.is_bot,
			userIdMatches: !(Number(cfg.chatId) > 0) || String(query.from?.id) === String(cfg.chatId),
			notVerified: !this._greetingVerified,
			notInFlight: !this._greetingReplyInFlight,
		};
		logInfo("[TelegramAdapter][DEBUG]", `  checks: ${JSON.stringify(checks)}`);

		if (query.data !== this._greetingToken || this._greetingMessageId === undefined ||
			query.message?.message_id !== this._greetingMessageId ||
			String(query.message?.chat.id) !== String(cfg.chatId) || query.from?.is_bot ||
			(Number(cfg.chatId) > 0 && String(query.from?.id) !== String(cfg.chatId)) ||
			this._greetingVerified || this._greetingReplyInFlight) {
			logInfo("[TelegramAdapter][DEBUG]", `  -> Callback rejected by condition check`);
			return true;
		}

		this._greetingReplyInFlight = true;
		const token = this._greetingToken;
		logInfo("[TelegramAdapter][DEBUG]", `  -> Processing greeting reply...`);

		try {
			const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/editMessageText`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: cfg.chatId, message_id: this._greetingMessageId,
					text: "Hi back received! Two-way communication with pi-harness-runtime is verified.",
					reply_markup: { inline_keyboard: [] },
				}),
				signal: AbortSignal.timeout(10000),
			});
			const data = await response.json() as { ok?: boolean };
			logInfo("[TelegramAdapter][DEBUG]", `  editMessageText response: ok=${data.ok}, status=${response.status}`);

			if (response.ok && data.ok === true && token === this._greetingToken) {
				this._greetingVerified = true;
				logInfo("[TelegramAdapter][DEBUG]", `  -> Greeting verified! Calling _greetingHandler`);
				this._greetingHandler?.();
			} else {
				logWarn("[TelegramAdapter][DEBUG]", `  -> Edit failed: ${JSON.stringify(data)}`);
			}
		} catch (err) {
			logWarn("[TelegramAdapter]", `Hi reply acknowledgment failed: ${err}`);
		} finally {
			this._greetingReplyInFlight = false;
		}
		return true;
	}

	/**
	 * Send a message with optional inline keyboard buttons
	 */
		async send(payload: NotificationPayload): Promise<NotificationResult> {
			try {
				// SECURITY: Jev-powered content filter - block if contains sensitive credentials
				const filterResult = await filterTelegramContent(payload);
				if (!filterResult.shouldSend) {
					logWarn(
						"[TelegramAdapter]",
						`BLOCKED by Jev judgment=${filterResult.judgment} reason=${filterResult.reason} job=${payload.jobId}`,
					);
					// Log safe notification metadata (no secrets)
					logInfo("[TelegramAdapter]", getSafeNotificationLog(payload));
					return {
						success: false,
						channel: this.id,
						error: "Content blocked: sensitive credentials detected",
					};
				}

				const cfg = this.config.config as TelegramConfig;
				const message = this.formatMessage(payload);

				// Chunk long messages (Telegram limit is ~4096)
				const chunks = this.chunkMessage(message);
				const totalChunks = chunks.length;

				// Log chunk count for telemetry (no full content)
				logInfo("[TelegramAdapter]", `Sending ${totalChunks} chunk(s) for job=${payload.jobId}`);

				// Read buttons from payload.details (set by notifyWithApproval)
				const enableInlineKeyboard = (payload.details?._enableInlineKeyboard as boolean) ?? cfg.enableInlineKeyboard;
				const actionButtons = (payload.details?._actionButtons as InlineKeyboardButton[]) ?? cfg.actionButtons;

				// Send each chunk sequentially
				let lastError: string | undefined;
				for (let i = 0; i < chunks.length; i++) {
					let chunkText = chunks[i];

					// Add part indicator for multi-chunk messages
					if (totalChunks > 1) {
						const partHeader = `[Part ${i + 1}/${totalChunks}]\n`;
						chunkText = partHeader + chunkText;
					}

					// Build request body
					const body: Record<string, unknown> = {
						chat_id: cfg.chatId,
						text: chunkText,
					};

					// Only add parse_mode if explicitly configured
					if (cfg.parseMode) {
						body.parse_mode = cfg.parseMode;
					}

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
						lastError = `Telegram API error: ${error}`;
						break;
					}
				}

				if (lastError) {
					return {
						success: false,
						channel: this.id,
						error: lastError,
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
				logError("[TelegramAdapter]", "Invalid webhook secret");
				return;
			}
		}

		// Handle callback query (button click)
		const callbackQuery = update.callback_query as Record<string, unknown> | undefined;
		if (callbackQuery) {
			const query = this.parseCallbackQuery(callbackQuery);
			if (query) {
				if (await this.handleGreetingReply(query)) {
					await this.answerCallbackQuery(query.id);
					return;
				}
				await this._callbackHandler?.(query.data, query, (msg) => this.acknowledgeCallback(query.id, msg));
				await this.answerCallbackQuery(query.id);
			}
		}

		// Handle regular messages (future: user can type commands)
		const message = update.message as Record<string, unknown> | undefined;
		if (message) {
			logInfo("[TelegramAdapter]", `Received message: ${message.text}`);
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
			logError("[TelegramAdapter]", "Failed to parse callback query");
			return null;
		}
	}

	/**
	 * Acknowledge a callback query - call this after validation in the handler
	 * @param callbackQueryId - The callback query ID to acknowledge
	 * @param message - Optional message to show in the popup alert
	 */
	async acknowledgeCallback(callbackQueryId: string, message?: string): Promise<void> {
		try {
			const cfg = this.config.config as TelegramConfig;
			await fetch(
				`https://api.telegram.org/bot${cfg.botToken}/answerCallbackQuery`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ 
						callback_query_id: callbackQueryId,
						text: message,
						show_alert: message ? true : false,
					}),
				},
			);
		} catch (error) {
			logError("[TelegramAdapter]", `Failed to acknowledge callback: ${error}`);
		}
	}

	/**
	 * Answer a callback query to remove loading state (internal legacy)
	 * @deprecated Use acknowledgeCallback() from the handler instead
	 */
	private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
		await this.acknowledgeCallback(callbackQueryId);
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
				logError("[TelegramAdapter]", `Webhook setup failed: ${await response.text()}`);
				return false;
			}

			logInfo("[TelegramAdapter]", `Webhook set to: ${webhookUrl}`);
			return true;
		} catch (error) {
			logError("[TelegramAdapter]", `Webhook setup error: ${error}`);
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
		const ordinal = payload.details?.ordinal as number | undefined;
		const planPath = payload.details?.planPath as string | undefined;
		const projectRoot = payload.details?.projectRoot as string | undefined;

		const maskedTaskTitle = typeof taskTitle === "string" ? maskString(taskTitle) : undefined;
		const maskedJobId = typeof jobId === "string" ? maskString(jobId) : undefined;
		const maskedError = typeof errorVal === "string" ? maskString(errorVal) : undefined;
		const maskedProjectRoot = typeof projectRoot === "string" ? maskString(projectRoot) : undefined;
		const maskedPlanPath = typeof planPath === "string" ? maskString(planPath) : undefined;

		// Get hostname for multi-machine identification
		const hostTag = `[${hostname()}]`;

		const label = this.getStatusLabel(payload.event);
		const title = `${label} ${maskedTitle} ${hostTag}`;
		const lines = [title];

		// Add metadata for Codex events
		if (maskedTaskTitle) {
			lines.push("", `Task: ${maskedTaskTitle}`);
		}
		if (maskedProjectRoot) {
			lines.push(`Root: ${maskedProjectRoot}`);
		}
		if (ordinal !== undefined) {
			lines.push(`Ordinal: ${ordinal}`);
		}
		if (maskedPlanPath) {
			lines.push(`Plan: ${maskedPlanPath}`);
		}

		// Add message content (artifact content flows through message)
		if (maskedMessage) {
			lines.push("", maskedMessage);
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

	/**
	 * Split long messages into ordered chunks for Telegram.
	 * Telegram message limit is ~4096 characters.
	 */
	private chunkMessage(text: string, maxLength = 3500): string[] {
		if (text.length <= maxLength) {
			return [text];
		}

		const chunks: string[] = [];
		let remaining = text;

		while (remaining.length > 0) {
			// Try to split at paragraph or line boundary
			let splitIndex = maxLength;
			const lastNewline = remaining.lastIndexOf("\n", maxLength);
			if (lastNewline > maxLength * 0.7) {
				// Found a good newline boundary
				splitIndex = lastNewline;
			} else {
				// Split at maxLength, but try to avoid cutting words
				const lastSpace = remaining.lastIndexOf(" ", maxLength);
				if (lastSpace > maxLength * 0.8) {
					splitIndex = lastSpace;
				}
			}

			chunks.push(remaining.slice(0, splitIndex));
			remaining = remaining.slice(splitIndex).trimStart();
		}

		return chunks;
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
			WaitingForUserInput: "[INPUT]",
			Info: "[INFO]",
			CodexSessionStarted: "[CODEX]",
			CodexPlanDetected: "[PLAN]",
			AssistantResponse: "[TODO]",
			ToolSummary: "[TOOL]",
		};
		return labels[event] ?? "[MSG]";
	}
}
