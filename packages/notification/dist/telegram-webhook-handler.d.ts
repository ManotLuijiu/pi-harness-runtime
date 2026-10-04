/**
 * Telegram Webhook Handler — RFC-0022
 *
 * Handles incoming webhook updates from Telegram (callback queries, messages).
 * This enables 2-way communication with inline keyboard buttons.
 */
import type { TelegramAdapter } from "./adapters/telegram-adapter.js";
import type { TelegramCallbackHandler, TelegramCallbackQuery } from "./types.js";
/**
 * Predefined action prefixes for callback data
 */
export declare const CallbackActions: {
    /** Approve/resume action */
    readonly APPROVE: "approve";
    /** Reject/cancel action */
    readonly REJECT: "reject";
    /** View details action */
    readonly VIEW: "view";
    /** Custom action prefix */
    readonly CUSTOM: "custom";
};
/**
 * Parsed callback data structure
 */
export interface ParsedCallback {
    action: string;
    targetId: string;
    payload?: Record<string, string>;
}
/**
 * Parse callback data string into structured object
 * Format: "action_targetId" or "action_targetId_key1=val1,key2=val2"
 */
export declare function parseCallbackData(data: string): ParsedCallback;
/**
 * Build callback data string from components
 */
export declare function buildCallbackData(action: string, targetId: string, payload?: Record<string, string>): string;
/**
 * Create a standard Yes/No callback handler
 */
export declare function createYesNoHandler(options: {
    /** Called when user clicks "Yes/Approve" */
    onApprove?: (targetId: string, query: TelegramCallbackQuery) => Promise<void> | void;
    /** Called when user clicks "No/Reject" */
    onReject?: (targetId: string, query: TelegramCallbackQuery) => Promise<void> | void;
    /** Custom handler for other callback actions */
    onCustom?: (action: string, targetId: string, query: TelegramCallbackQuery) => Promise<void> | void;
    /** Job manager reference for default resume/cancel behavior */
    jobManager?: {
        resume: (jobId: string) => Promise<void>;
        cancel: (jobId: string) => Promise<void>;
    };
}): TelegramCallbackHandler;
/**
 * Telegram webhook route handler for Express/Fastify/etc.
 */
export declare function createTelegramWebhookHandler(adapter: TelegramAdapter, secretToken?: string): (req: {
    body: Record<string, unknown>;
    headers: Record<string, string | undefined>;
}, res: {
    sendStatus: (code: number) => void;
}) => Promise<void>;
/**
 * Notification payload helper with inline keyboard support
 */
export declare function createInteractivePayload(event: string, jobId: string, title: string, message: string, buttons: Array<{
    text: string;
    action: string;
    targetId: string;
}>, details?: Record<string, unknown>): {
    event: string;
    jobId: string;
    timestamp: string;
    title: string;
    message: string;
    details?: Record<string, unknown>;
};
/**
 * Update TelegramConfig to include action buttons from payload details
 */
export declare function extractButtonsFromPayload(details: Record<string, unknown> | undefined): Array<{
    text: string;
    callbackData: string;
}> | undefined;
//# sourceMappingURL=telegram-webhook-handler.d.ts.map