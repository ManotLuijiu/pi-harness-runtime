/**
 * Telegram Webhook Handler — RFC-0022
 *
 * Handles incoming webhook updates from Telegram (callback queries, messages).
 * This enables 2-way communication with inline keyboard buttons.
 */
/**
 * Predefined action prefixes for callback data
 */
export const CallbackActions = {
    /** Approve/resume action */
    APPROVE: "approve",
    /** Reject/cancel action */
    REJECT: "reject",
    /** View details action */
    VIEW: "view",
    /** Custom action prefix */
    CUSTOM: "custom",
};
/**
 * Parse callback data string into structured object
 * Format: "action_targetId" or "action_targetId_key1=val1,key2=val2"
 */
export function parseCallbackData(data) {
    const parts = data.split("_");
    const action = parts[0] || "";
    const targetId = parts[1] || "";
    let payload;
    // Check for additional payload
    const payloadPart = parts.slice(2).join("_");
    if (payloadPart && payloadPart.includes("=")) {
        payload = {};
        for (const pair of payloadPart.split(",")) {
            const [key, value] = pair.split("=");
            if (key && value) {
                payload[key] = value;
            }
        }
    }
    return { action, targetId, payload };
}
/**
 * Build callback data string from components
 */
export function buildCallbackData(action, targetId, payload) {
    let data = `${action}_${targetId}`;
    if (payload && Object.keys(payload).length > 0) {
        const pairs = Object.entries(payload)
            .map(([k, v]) => `${k}=${v}`)
            .join(",");
        data += `_${pairs}`;
    }
    return data;
}
/**
 * Create a standard Yes/No callback handler
 */
export function createYesNoHandler(options) {
    return async (data, query) => {
        const parsed = parseCallbackData(data);
        const { action, targetId } = parsed;
        console.log(`[TelegramWebhook] Callback: action=${action}, target=${targetId}, from=${query.from.username || query.from.first_name}`);
        switch (action) {
            case CallbackActions.APPROVE:
                if (options.onApprove) {
                    await options.onApprove(targetId, query);
                }
                else if (options.jobManager) {
                    await options.jobManager.resume(targetId);
                    console.log(`[TelegramWebhook] Job resumed: ${targetId}`);
                }
                break;
            case CallbackActions.REJECT:
                if (options.onReject) {
                    await options.onReject(targetId, query);
                }
                else if (options.jobManager) {
                    await options.jobManager.cancel(targetId);
                    console.log(`[TelegramWebhook] Job cancelled: ${targetId}`);
                }
                break;
            case CallbackActions.VIEW:
                if (options.onCustom) {
                    await options.onCustom(action, targetId, query);
                }
                break;
            default:
                if (options.onCustom) {
                    await options.onCustom(action, targetId, query);
                }
                else {
                    console.warn(`[TelegramWebhook] Unknown action: ${action}`);
                }
        }
    };
}
/**
 * Telegram webhook route handler for Express/Fastify/etc.
 */
export function createTelegramWebhookHandler(adapter, secretToken) {
    return async (req, res) => {
        // Verify secret token
        if (secretToken) {
            const receivedToken = req.headers["x-telegram-bot-api-secret-token"];
            if (receivedToken !== secretToken) {
                console.error("[TelegramWebhook] Unauthorized webhook request");
                res.sendStatus(403);
                return;
            }
        }
        try {
            await adapter.handleWebhookUpdate(req.body);
            res.sendStatus(200);
        }
        catch (error) {
            console.error("[TelegramWebhook] Error processing update:", error);
            res.sendStatus(500);
        }
    };
}
/**
 * Notification payload helper with inline keyboard support
 */
export function createInteractivePayload(event, jobId, title, message, buttons, details) {
    return {
        event,
        jobId,
        timestamp: new Date().toISOString(),
        title,
        message,
        details: {
            ...details,
            _callbackButtons: buttons.map((b) => ({
                text: b.text,
                callbackData: buildCallbackData(b.action, b.targetId),
            })),
        },
    };
}
/**
 * Update TelegramConfig to include action buttons from payload details
 */
export function extractButtonsFromPayload(details) {
    if (!details)
        return undefined;
    const cb = details._callbackButtons;
    return cb?.length ? cb : undefined;
}
//# sourceMappingURL=telegram-webhook-handler.js.map