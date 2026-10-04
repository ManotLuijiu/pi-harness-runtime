/**
 * Webhook Adapter — RFC-0022
 *
 * Sends notifications to a generic webhook endpoint.
 */
import type { NotificationPayload, NotificationResult, WebhookConfig } from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";
export declare class WebhookAdapter extends BaseChannelAdapter {
    readonly id = "webhook";
    readonly type = "webhook";
    constructor(config: WebhookConfig);
    initialize(): Promise<boolean>;
    send(payload: NotificationPayload): Promise<NotificationResult>;
}
//# sourceMappingURL=webhook-adapter.d.ts.map