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
export declare class TelegramAdapter extends BaseChannelAdapter {
    readonly id = "telegram";
    readonly type = "telegram";
    private _botUsername;
    private _callbackHandler;
    private _messageHandler;
    private _webhookSecret;
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
    get botUsername(): string | undefined;
    initialize(): Promise<boolean>;
    /**
     * Start polling for Telegram updates (callback queries, etc.)
     */
    startPolling(): void;
    /**
     * Stop polling
     */
    stopPolling(): void;
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
     * Parse callback query from webhook update
     */
    private parseCallbackQuery;
    /**
     * Answer a callback query to remove loading state
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
    private getStatusLabel;
}
export {};
//# sourceMappingURL=telegram-adapter.d.ts.map