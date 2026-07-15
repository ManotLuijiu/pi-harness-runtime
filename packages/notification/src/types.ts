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
	config: TelegramConfig | NtfyConfig | EmailConfig | WebhookConfig;
}

export type NotificationChannelType = "telegram" | "ntfy" | "email" | "webhook";

export interface TelegramConfig {
	botToken: string;
	chatId: string;
	parseMode?: "MarkdownV2" | "HTML" | "Markdown";
}

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
