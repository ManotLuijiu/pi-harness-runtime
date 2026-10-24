/**
 * Telegram Adapter — RFC-0022
 *
 * Sends notifications via Telegram Bot API.
 */
import type { NotificationPayload, NotificationResult, TelegramCallbackHandler, TelegramConfig } from "../types.js";
/**
 * Telegram update object from getUpdates
 */
type TelegramMessageHandler = (text: string, chatId: string) => Promise<void>;
import { BaseChannelAdapter } from "../base-adapter.js";
/**
 * The status label of an event.
 *
 * Use ASCII labels per AGENTS.md convention - emoji render inconsistently
 * across terminals and break the alignment of the machine readable output.
 */
export declare function telegramStatusLabel(event: NotificationPayload["event"]): string;
/**
 * Render the Telegram message of a payload.
 *
 * Exported so the rendering can be tested without a Telegram connection: the
 * detail footer must never label a resume trigger as an error.
 */
export declare function buildTelegramMessage(payload: NotificationPayload): string;
export declare class TelegramAdapter extends BaseChannelAdapter {
    readonly id = "telegram";
    readonly type = "telegram";
    private _botUsername;
    private _callbackHandler;
    private _messageHandler;
    private _webhookSecret;
    private _webhookActive;
    private _pollInterval;
    private _lastUpdateId;
    private _pollTimeoutMs;
    private _pollLimit;
    private _pollInFlight;
    private _pollAbort;
    private _greetingToken;
    private _greetingMessageId;
    private _greetingVerified;
    private _greetingReplyInFlight;
    private _greetingHandler;
    /** Why the poll loop is not running (null = running, or never needed). */
    private _pollStopReason;
    /** How many 409 retries have been scheduled. */
    private _pollRetryCount;
    /** Timer of the scheduled 409 retry. */
    private _pollRetryTimer;
    /**
     * True when polling was stopped on purpose (stopPolling). A pending
     * 409 retry must not fire afterwards.
     */
    private _pollStopped;
    /**
     * True when the 409 retry chain gave up. The reason is reported
     * exactly once.
     */
    private _pollGaveUp;
    /**
     * True when the poll stop reason was already reported. The report is
     * one shot: a later startPolling() must not produce a second
     * "retries exhausted" with the same reason.
     */
    private _pollStopReported;
    /**
     * Called when the poll loop stops because Telegram answered 409.
     * The harness uses it to tell the user that the inbound path degraded.
     */
    onPollStopped: ((reason: string) => void) | undefined;
    /**
     * The backoff of the 409 retries. Public so a test can shorten it.
     */
    pollRetryBaseDelayMs: number;
    pollRetryMaxAttempts: number;
    setGreetingVerifiedHandler(handler: () => void): void;
    isGreetingVerified(): boolean;
    constructor(config: TelegramConfig);
    /**
     * Register a callback handler for inline keyboard button clicks
     */
    setCallbackHandler(handler: TelegramCallbackHandler): void;
    /**
     * Register a message handler for inbound Telegram messages
     */
    setMessageHandler(handler: TelegramMessageHandler): void;
    /**
     * Set webhook secret for verification
     */
    setWebhookSecret(secret: string): void;
    /**
     * Mark webhook as active (called by webhook setup)
     */
    setWebhookActive(active: boolean): void;
    get botUsername(): string | undefined;
    initialize(): Promise<boolean>;
    /**
     * True when a separate webhook server owns the Telegram updates.
     *
     * Polling and a webhook are mutually exclusive: Telegram rejects
     * getUpdates while a webhook is active, and every rejected poll also
     * terminates the getUpdates stream of the OTHER poller of the same bot.
     * That is how an inbound text message got delayed by seconds.
     */
    isWebhookConfigured(): boolean;
    /**
     * True while the getUpdates poll loop is running.
     */
    isPolling(): boolean;
    /**
     * True when a webhook was registered for this bot. A webhook and polling
     * are mutually exclusive: Telegram rejects getUpdates while a webhook is
     * active.
     */
    isWebhookActive(): boolean;
    /**
     * Why the poll loop is not running (null = it runs, or was never needed).
     *
     * The harness shows this in the startup summary: a silent 409 would look
     * like a working inbound path.
     */
    getPollStopReason(): string | null;
    /**
     * Report that the inbound path stopped - exactly once.
     *
     * A report that is repeated would show the same warning twice; a
     * report that is lost would hide a broken inbound path.
     */
    private reportPollStopped;
    /**
     * Schedule a bounded retry after a 409.
     *
     * Only used when no webhook is configured: there the harness poll is the
     * only inbound path, so it must survive a competing poller instead of
     * giving up after the first rejection.
     */
    private schedulePollRetry;
    /**
     * Start polling for Telegram updates (callback queries, etc.)
     */
    startPolling(): void;
    /**
     * Stop polling
     *
     * The stop reason is kept: it is the diagnosis of a broken inbound path
     * (a 409 by another poller) and the startup summary reads it.
     */
    stopPolling(): void;
    /**
     * Stop the poll loop but keep the 409 retry chain alive.
     */
    private clearPollInterval;
    /**
     * Poll for updates using getUpdates
     */
    private poll;
    /**
     * Process a single Telegram update
     */
    private processUpdate;
    /**
     * Verify outbound delivery with a fixed startup greeting. No user content is sent.
     */
    sendStartupGreeting(): Promise<NotificationResult>;
    /** A greeting callback is a transport check, not new agent work or approval. */
    private handleGreetingReply;
    /**
     * Send a message with optional inline keyboard buttons
     */
    send(payload: NotificationPayload): Promise<NotificationResult>;
    /**
     * Send a question that expects a text response from the user.
     * Writes response metadata to a file for polling.
     */
    sendQuestion(payload: NotificationPayload, responseDir?: string): Promise<NotificationResult>;
    /**
     * Build inline keyboard markup from button configuration
     */
    private buildInlineKeyboard;
    /**
     * Process incoming webhook update from Telegram
     */
    handleWebhookUpdate(update: Record<string, unknown>): Promise<void>;
    /**
     * Forward a text message that arrived through the webhook to the
     * registered message handler. Same rules as the polling path: no bots and
     * only the configured chat.
     */
    private forwardWebhookMessage;
    /**
     * True when the sender may write into Pi.
     *
     * ONE rule, shared with the remote webhook server
     * (packages/notification/src/telegram-auth.ts): the SENDER decides, an
     * allow-list is authoritative, otherwise the configured chat id
     * identifies the sender. With neither configured nobody may.
     */
    private isAuthorizedSender;
    /**
     * Parse callback query from webhook update
     */
    private parseCallbackQuery;
    /**
     * Acknowledge a callback query - call this after validation in the handler
     * @param callbackQueryId - The callback query ID to acknowledge
     * @param message - Optional message to show in the popup alert
     */
    acknowledgeCallback(callbackQueryId: string, message?: string): Promise<void>;
    /**
     * Answer a callback query to remove loading state (internal legacy)
     * @deprecated Use acknowledgeCallback() from the handler instead
     */
    private answerCallbackQuery;
    /**
     * Setup webhook for receiving updates
     */
    setupWebhook(webhookUrl: string): Promise<boolean>;
    /**
     * Get current webhook info
     */
    getWebhookInfo(): Promise<Record<string, unknown> | null>;
    private formatMessage;
    /**
     * Split long messages into ordered chunks for Telegram.
     * Telegram message limit is ~4096 characters.
     */
    private chunkMessage;
    private getStatusLabel;
}
export {};
//# sourceMappingURL=telegram-adapter.d.ts.map