/**
 * Telegram Adapter — RFC-0022
 *
 * Sends notifications via Telegram Bot API.
 */
import type { NotificationPayload, NotificationResult, TelegramCallbackHandler, TelegramConfig } from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";
export declare class TelegramAdapter extends BaseChannelAdapter {
    readonly id = "telegram";
    readonly type = "telegram";
    private _botUsername;
    private _callbackHandler;
    private _webhookSecret;
    constructor(config: TelegramConfig);
    /**
     * Register a callback handler for inline keyboard button clicks
     */
    setCallbackHandler(handler: TelegramCallbackHandler): void;
    /**
     * Set webhook secret for verification
     */
    setWebhookSecret(secret: string): void;
    get botUsername(): string | undefined;
    initialize(): Promise<boolean>;
    /**
     * Send a message with optional inline keyboard buttons
     */
    send(payload: NotificationPayload): Promise<NotificationResult>;
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
    private getEmoji;
}
//# sourceMappingURL=telegram-adapter.d.ts.map