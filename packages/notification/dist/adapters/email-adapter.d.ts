/**
 * Email Adapter — RFC-0022
 *
 * Sends notifications via SMTP.
 */
import type { NotificationPayload, NotificationResult, EmailConfig } from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";
export declare class EmailAdapter extends BaseChannelAdapter {
    readonly id = "email";
    readonly type = "email";
    constructor(config: EmailConfig);
    initialize(): Promise<boolean>;
    send(payload: NotificationPayload): Promise<NotificationResult>;
    private formatBody;
    private getEmoji;
}
//# sourceMappingURL=email-adapter.d.ts.map