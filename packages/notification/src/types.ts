/**
 * Notification Center Types — RFC-0022
 *
 * Type definitions for notification events, channels, and payloads.
 */

export type NotificationEvent =
	| "JobStarted"
	| "TaskCompleted"
	| "TaskFailed"
	| "QuotaPaused"
	| "ResumeScheduled"
	| "ContextCompacted"
	| "OutputLimitContinued"
	| "E2EFailed"
	| "HumanReviewNeeded"
	| "ReadyForClient"
	| "JobCancelled"
	| "WaitingForUserInput"
	| "CodexSessionStarted"
	| "CodexPlanDetected"
	| "Error";

export interface NotificationPayload {
	event: NotificationEvent;
	jobId: string;
	timestamp: string;
	title: string;
	message: string;
	details?: Record<string, unknown>;
	// Redacted fields for security
	redacted?: string[];
}

export interface NotificationConfig {
	channels: NotificationChannelConfig[];
	// Global settings
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
	// Inline keyboard support for 2-way communication
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
		chat: { id: number };
		message_id: number;
	};
}

/**
 * Callback handler function type
 */
export type TelegramCallbackHandler = (
	callbackData: string,
	query: TelegramCallbackQuery
) => Promise<void> | void;

export interface NtfyConfig {
	server: string; // e.g., "https://ntfy.sh"
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
	error?: string;
}
