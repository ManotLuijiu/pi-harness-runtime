/**
 * Notification Center Types — RFC-0022
 *
 * Type definitions for notification events, channels, and payloads.
 */
export type NotificationEvent = "JobStarted" | "TaskCompleted" | "TaskFailed" | "QuotaPaused" | "ResumeScheduled" | "ContextCompacted" | "OutputLimitContinued" | "E2EFailed" | "HumanReviewNeeded" | "ReadyForClient" | "JobCancelled" | "WaitingForUserInput" | "CodexSessionStarted" | "CodexPlanDetected" | "CodexReviewDetected" | "ToolingPreferenceProposal" | "AssistantResponse" | "ToolSummary" | "Error" | "Info";
export interface NotificationPayload {
    event: NotificationEvent;
    jobId: string;
    timestamp: string;
    title: string;
    message: string;
    details?: Record<string, unknown>;
    redacted?: string[];
    enableInlineKeyboard?: boolean;
    actionButtons?: InlineKeyboardButton[];
    /** The canonical pending-question request ID (the approval correlation key). */
    questionId?: string;
}
export interface NotificationConfig {
    channels: NotificationChannelConfig[];
    enabled?: boolean;
    redactPatterns?: RegExp[];
}
export interface NotificationChannelConfig {
    id: string;
    type: NotificationChannelType;
    enabled: boolean;
    config: TelegramConfig | NtfyConfig | EmailConfig | WebhookConfig | LineConfig;
}
export type NotificationChannelType = "telegram" | "ntfy" | "email" | "webhook" | "line";
export interface TelegramConfig {
    botToken: string;
    chatId: string;
    parseMode?: "MarkdownV2" | "HTML" | "Markdown";
    /**
     * Users that may write into Pi (their user id). Empty/absent means only
     * `chatId` is allowed; if both are absent nobody may write in.
     */
    allowedUserIds?: number[];
    enableInlineKeyboard?: boolean;
    actionButtons?: InlineKeyboardButton[];
}
/**
 * Inline keyboard button for Telegram interactive messages
 */
export interface InlineKeyboardButton {
    /** Button text displayed to user */
    text: string;
    /** Callback data sent when button is clicked */
    callbackData: string;
    /** Optional URL to open when button is clicked (mutually exclusive with callbackData) */
    url?: string;
}
/**
 * Callback query received from Telegram inline keyboard
 */
export interface TelegramCallbackQuery {
    id: string;
    from: {
        id: number;
        is_bot: boolean;
        first_name: string;
        username?: string;
    };
    chat_instance: string;
    data: string;
    message?: {
        chat: {
            id: number;
        };
        message_id: number;
    };
}
/**
 * Callback handler function type
 */
export type TelegramCallbackHandler = (callbackData: string, query: TelegramCallbackQuery, acknowledge: (message?: string) => Promise<void>) => Promise<void> | void;
export interface NtfyConfig {
    server: string;
    topic: string;
    authToken?: string;
}
export interface EmailConfig {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string;
    from: string;
    to: string[];
    tls?: boolean;
}
export interface WebhookConfig {
    url: string;
    method?: "POST" | "PUT";
    headers?: Record<string, string>;
    authToken?: string;
}
export interface LineConfig {
    channelAccessToken: string;
    userId: string;
}
export interface NotificationResult {
    success: boolean;
    channel: string;
    error?: string;
}
export interface NotificationContext {
    jobId: string;
    requirement: string;
    taskId?: string;
    taskTitle?: string;
    /** A real failure. Only error events render this under an "Error:" label. */
    error?: string;
    /** Why the event happened (a resume trigger, a quota detail, a review reason). */
    reason?: string;
    /**
     * Why the work resumed ("post-compact", "provider-overload"). A trigger is
     * not a failure: it renders as "Trigger: ..." in a human wording, never
     * under an "Error:" label.
     */
    trigger?: string;
    /**
     * The canonical pending-question request ID.
     *
     * It is the approval correlation key: the callback data of every Yes/No
     * action points at it. The presentation `jobId` may carry a prefix and
     * must not be used for the correlation.
     */
    questionId?: string;
    /** The kind of the pending question (approval, clarification, ...). */
    questionKind?: string;
}
//# sourceMappingURL=types.d.ts.map