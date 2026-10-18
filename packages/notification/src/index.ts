/**
 * Notification Center (RFC-0029)
 *
 * Unified notification system for the harness runtime.
 */

export * from "./notification-center.js";
export * from "./base-adapter.js";
export * from "./types.js";
export * from "./telegram-webhook-handler.js";
export * from "./pending-question.js";
export { requiresApproval, isHighPriority } from "./notification-policy.js";
export { LineAdapter } from "./adapters/line-adapter.js";
export { TelegramAdapter } from "./adapters/telegram-adapter.js";
export {
	maskString,
	maskValue,
	maskObject,
	maskPayload,
	isSensitiveField,
} from "./mask-secrets.js";
export {
	filterTelegramContent,
	getSafeNotificationLog,
} from "./telegram-content-filter.js";
export {
	ConversationBridge,
	createConversationBridge,
} from "./conversation-bridge.js";

// Harness widget exports
export { HarnessWidget, createHarnessWidget } from "./harness-widget-manager.js";
export type { HarnessStatus, StatusDetail, HonchoStatus, TelegramStatus, SkillsStatus } from "./harness-types.js";
export {
	renderWidgetBody,
	createInitialStatus,
	getTerminalWidth,
	truncate,
	truncateMiddle,
} from "./harness-widget.js";
