/**
 * Notification Center — RFC-0022
 *
 * Main orchestration class for sending notifications across multiple channels.
 *
 * Security Rules (RFC-0022):
 * - Do not send raw cookies, passwords, provider tokens
 * - Redact sensitive data before sending
 * - Notification failure does not crash runtime
 */
import type { InlineKeyboardButton, NotificationEvent, NotificationConfig, NotificationChannelConfig, NotificationResult, NotificationContext, TelegramCallbackHandler } from "./types.js";
import { TelegramAdapter } from "./adapters/telegram-adapter.js";
/**
 * Pending approval request
 */
export interface PendingApproval {
    jobId: string;
    event: string;
    context: NotificationContext;
    createdAt: Date;
    resolved: boolean;
    result?: "approved" | "rejected";
}
export declare class NotificationCenter {
    private adapters;
    private channelEnabled;
    private redactPatterns;
    private db;
    /** Pending approval requests keyed by jobId */
    private pendingApprovals;
    /**
     * Get SQLite database path
     */
    private static getDatabasePath;
    /**
     * Initialize SQLite database
     */
    private initDatabase;
    /**
     * Save channel settings to SQLite
     */
    private saveChannelSettings;
    /**
     * Track a new pending approval request
     */
    trackPendingApproval(jobId: string, event: NotificationEvent, context: NotificationContext): void;
    /**
     * Resolve a pending approval request
     * @returns true if the request was found and resolved, false otherwise
     */
    resolvePendingApproval(jobId: string, result: "approved" | "rejected"): boolean;
    /**
     * Get a pending approval request
     */
    getPendingApproval(jobId: string): PendingApproval | undefined;
    /**
     * Check if a pending approval exists and is unresolved
     */
    isPendingApproval(jobId: string): boolean;
    /**
     * Clear resolved pending approvals older than maxAgeMs
     */
    cleanupResolvedApprovals(maxAgeMs?: number): void;
    constructor(config?: NotificationConfig);
    /**
     * Register a new adapter
     */
    registerAdapter(config: NotificationChannelConfig): boolean;
    /**
     * Initialize all registered adapters
     */
    initialize(): Promise<void>;
    /**
     * Check if a channel is enabled
     */
    isChannelEnabled(channelId: string): boolean;
    /**
     * Set channel enabled/disabled state
     */
    setChannelEnabled(channelId: string, enabled: boolean): void;
    /**
     * Toggle a channel's enabled state
     */
    toggleChannel(channelId: string): boolean;
    /**
     * Build channel toggle buttons for inline keyboard
     */
    buildToggleButtons(): InlineKeyboardButton[];
    /**
     * Set callback handler for Telegram adapters
     * Enables handling of inline keyboard button clicks (approve/reject)
     */
    setCallbackHandler(handler: TelegramCallbackHandler): void;
    /**
     * Set message handler for inbound Telegram messages (forwarded to Pi)
     */
    setMessageHandler(handler: (text: string, chatId: string) => Promise<void>): void;
    /**
     * Send a notification to all configured channels
     */
    notify(event: NotificationEvent, context: NotificationContext, options?: {
        /** Whether to include channel toggle buttons (default: true) */
        includeToggles?: boolean;
    }): Promise<NotificationResult[]>;
    /**
     * Send notification to a specific channel
     */
    notifyChannel(channelId: string, event: NotificationEvent, context: NotificationContext): Promise<NotificationResult>;
    /**
     * Check if any notifications are configured
     */
    hasChannels(): boolean;
    /**
     * Check if any adapter is healthy (initialized and working)
     * Unlike hasChannels(), this verifies actual health, not just config
     */
    hasHealthyChannels(): boolean;
    /**
     * Is one specific channel healthy (initialized and working)?
     *
     * `hasHealthyChannels()` cannot tell WHICH channel works - a Telegram
     * adapter that is healthy says nothing about a LINE adapter that failed
     * to initialize. The startup summary needs the per-channel answer to
     * report a channel as "enabled" only when it really is.
     */
    isChannelHealthy(channelId: string): boolean;
    /**
     * List all configured channels
     */
    listChannels(): string[];
    /**
     * Get Telegram bot username if configured
     */
    getTelegramBotUsername(): string | undefined;
    /**
     * Get Telegram adapter for advanced operations (webhook setup, etc.)
     */
    getTelegramAdapter(): TelegramAdapter | undefined;
    /**
     * Set callback handler for Telegram inline keyboard button clicks
     */
    setTelegramCallbackHandler(handler: TelegramCallbackHandler): void;
    /**
     * Set webhook secret for Telegram updates verification
     */
    setTelegramWebhookSecret(secret: string): void;
    /**
     * Setup Telegram webhook for receiving updates
     */
    setupTelegramWebhook(webhookUrl: string): Promise<boolean>;
    /**
     * Send notification with interactive Yes/No buttons
     */
    notifyWithApproval(event: NotificationEvent, context: NotificationContext, options?: {
        /** Custom button labels */
        approveLabel?: string;
        rejectLabel?: string;
        /** Additional details for the message */
        additionalDetails?: Record<string, unknown>;
    }): Promise<NotificationResult[]>;
    /**
     * Send a question that expects a text response from the user.
     * Unlike notifyWithApproval (Yes/No buttons), this sends a plain message
     * and waits for the user to type their response.
     */
    notifyWithQuestion(event: NotificationEvent, context: NotificationContext, options?: {
        /** Custom question to ask */
        question?: string;
        /** Hint for expected response format */
        expectedFormat?: string;
        /** Response directory for tracking */
        responseDir?: string;
    }): Promise<NotificationResult[]>;
    /**
     * Send interactive notification with custom buttons
     */
    notifyWithButtons(event: NotificationEvent, context: NotificationContext, buttons: Array<{
        text: string;
        action: string;
        targetId: string;
        url?: string;
    }>, options?: {
        /** Additional details for the message */
        additionalDetails?: Record<string, unknown>;
    }): Promise<NotificationResult[]>;
    private createAdapter;
    private buildPayload;
    private getEventContent;
    private redact;
    private getDefaultRedactPatterns;
}
//# sourceMappingURL=notification-center.d.ts.map