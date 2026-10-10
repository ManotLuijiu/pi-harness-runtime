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
import type { NotificationEvent, NotificationConfig, NotificationChannelConfig, NotificationResult, NotificationContext, TelegramCallbackHandler } from "./types.js";
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
    private redactPatterns;
    /** Pending approval requests keyed by jobId */
    private pendingApprovals;
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
     * Set callback handler for Telegram adapters
     * Enables handling of inline keyboard button clicks (approve/reject)
     */
    setCallbackHandler(handler: TelegramCallbackHandler): void;
    /**
     * Send a notification to all configured channels
     */
    notify(event: NotificationEvent, context: NotificationContext): Promise<NotificationResult[]>;
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