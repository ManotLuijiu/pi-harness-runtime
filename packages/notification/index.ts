/**
 * Notification Center — RFC-0022
 *
 * Mobile notification system for harness runtime events.
 *
 * @example
 * ```typescript
 * import { NotificationCenter } from "./notification/index.js";
 *
 * const center = new NotificationCenter({
 *   channels: [
 *     {
 *       id: "my-telegram",
 *       type: "telegram",
 *       enabled: true,
 *       config: {
 *         botToken: process.env.TELEGRAM_BOT_TOKEN,
 *         chatId: "YOUR_CHAT_ID",
 *       },
 *     },
 *   ],
 * });
 *
 * await center.initialize();
 *
 * await center.notify("JobStarted", {
 *   jobId: "job-123",
 *   requirement: "Build a REST API",
 * });
 * ```
 */

export { NotificationCenter } from "./notification-center.js";
export { TelegramAdapter } from "./adapters/telegram-adapter.js";
export { NtfyAdapter } from "./adapters/ntfy-adapter.js";
export { EmailAdapter } from "./adapters/email-adapter.js";
export { WebhookAdapter } from "./adapters/webhook-adapter.js";

export type {
	NotificationEvent,
	NotificationPayload,
	NotificationConfig,
	NotificationChannelConfig,
	NotificationChannelType,
	NotificationResult,
	NotificationContext,
	TelegramConfig,
	NtfyConfig,
	EmailConfig,
	WebhookConfig,
} from "./types.js";
