/**
 * Ntfy Adapter — RFC-0022
 *
 * Sends notifications via ntfy.sh (or self-hosted ntfy server).
 */
import type { NotificationPayload, NotificationResult, NtfyConfig } from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";
export declare class NtfyAdapter extends BaseChannelAdapter {
    readonly id = "ntfy";
    readonly type = "ntfy";
    constructor(config: NtfyConfig);
    initialize(): Promise<boolean>;
    send(payload: NotificationPayload): Promise<NotificationResult>;
    private formatMessage;
    private getTags;
}
//# sourceMappingURL=ntfy-adapter.d.ts.map