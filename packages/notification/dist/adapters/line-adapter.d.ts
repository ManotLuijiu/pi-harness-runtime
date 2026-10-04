/**
 * LINE Adapter — RFC-0022
 *
 * Sends notifications via LINE Messaging API.
 */
import type { NotificationPayload, NotificationResult, LineConfig } from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";
export declare class LineAdapter extends BaseChannelAdapter {
    readonly id = "line";
    readonly type = "line";
    constructor(config: LineConfig);
    initialize(): Promise<boolean>;
    send(payload: NotificationPayload): Promise<NotificationResult>;
    private formatMessage;
    private getEmoji;
}
//# sourceMappingURL=line-adapter.d.ts.map