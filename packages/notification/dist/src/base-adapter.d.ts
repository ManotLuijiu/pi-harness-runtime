/**
 * Notification Base Adapter — RFC-0022
 *
 * Abstract base class for all notification channel adapters.
 */
import type { NotificationPayload, NotificationChannelConfig, NotificationResult } from "./types.js";
export interface ChannelAdapter {
    readonly id: string;
    readonly type: string;
    /**
     * Initialize the adapter (e.g., verify credentials)
     */
    initialize(): Promise<boolean>;
    /**
     * Send a notification
     */
    send(payload: NotificationPayload): Promise<NotificationResult>;
    /**
     * Check if the adapter is properly configured
     */
    isConfigured(): boolean;
}
export declare abstract class BaseChannelAdapter implements ChannelAdapter {
    protected config: NotificationChannelConfig;
    abstract readonly id: string;
    abstract readonly type: string;
    constructor(config: NotificationChannelConfig);
    abstract initialize(): Promise<boolean>;
    abstract send(payload: NotificationPayload): Promise<NotificationResult>;
    isConfigured(): boolean;
    /**
     * Redact sensitive data from payload before sending
     */
    protected redact(payload: NotificationPayload, patterns: RegExp[]): NotificationPayload;
}
//# sourceMappingURL=base-adapter.d.ts.map