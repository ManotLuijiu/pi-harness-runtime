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
    /**
     * Check if the adapter is healthy (initialized and working)
     * Returns true if initialized successfully, false otherwise
     */
    isHealthy(): boolean;
    /**
     * Why the adapter is not healthy (null when it is healthy or when the
     * adapter has nothing to say).
     *
     * The message must be safe to show to a user: no token, no credential,
     * no raw response body that could echo one back.
     */
    getDiagnostic?(): string | null;
}
export declare abstract class BaseChannelAdapter implements ChannelAdapter {
    protected config: NotificationChannelConfig;
    protected _healthy: boolean;
    protected _diagnostic: string | null;
    abstract readonly id: string;
    abstract readonly type: string;
    constructor(config: NotificationChannelConfig);
    abstract initialize(): Promise<boolean>;
    abstract send(payload: NotificationPayload): Promise<NotificationResult>;
    isConfigured(): boolean;
    /**
     * Default health check - subclasses should override for actual health verification
     */
    isHealthy(): boolean;
    /**
     * Mark adapter as healthy (called after successful initialize)
     */
    protected markHealthy(): void;
    /**
     * Record why the adapter is not healthy.
     *
     * The reason is what the startup summary shows, so it must be short and
     * must never contain a credential.
     */
    protected setDiagnostic(reason: string | null): void;
    /**
     * Why the adapter is not healthy (null when healthy).
     */
    getDiagnostic(): string | null;
    /**
     * Redact sensitive data from payload before sending
     */
    protected redact(payload: NotificationPayload, patterns: RegExp[]): NotificationPayload;
}
//# sourceMappingURL=base-adapter.d.ts.map