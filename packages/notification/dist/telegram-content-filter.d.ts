/**
 * Telegram Content Filter — Jev-Powered Sensitive Content Detection
 *
 * Before sending to Telegram, this module analyzes content for sensitive
 * credentials that should NOT be transmitted.
 */
import type { NotificationPayload } from "./types.js";
/**
 * Jev judgment result for content filtering
 */
export type ContentJudgment = "SEND" | "BLOCK" | "UNKNOWN";
/**
 * Result of content filtering decision
 */
export interface FilterResult {
    /** Whether to send to Telegram */
    shouldSend: boolean;
    /** Jev's judgment */
    judgment: ContentJudgment;
    /** Reason for blocking (if blocked) */
    reason?: string;
    /** Confidence score (0-1) */
    confidence?: number;
}
/**
 * Filter notification content before sending to Telegram
 *
 * @param payload - The notification payload
 * @returns Filter result with decision
 */
export declare function filterTelegramContent(payload: NotificationPayload): Promise<FilterResult>;
/**
 * Get safe notification version (masked) for logging
 */
export declare function getSafeNotificationLog(payload: NotificationPayload): string;
//# sourceMappingURL=telegram-content-filter.d.ts.map