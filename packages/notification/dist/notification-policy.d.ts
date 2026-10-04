/**
 * Notification Policy Engine for intelligent routing
 *
 * Decides:
 * 1. Should we notify at all?
 * 2. What channel(s)?
 * 3. Should we include approval buttons?
 * 4. What's the priority level?
 *
 * Can be extended with Jev for AI-powered decisions:
 * import { Jev } from "@type-safe/ai";
 */
export interface NotificationContext {
    event: string;
    jobId?: string;
    requirement?: string;
    error?: string;
    severity?: "low" | "medium" | "high" | "critical";
    requiresApproval?: boolean;
    userId?: number;
    timestamp?: string;
}
export interface NotificationPolicy {
    shouldNotify: boolean;
    channels: ("telegram" | "tui" | "log")[];
    includeButtons: boolean;
    priority: "low" | "normal" | "high" | "urgent";
    message?: string;
}
export interface UserPreferences {
    telegramEnabled: boolean;
    telegramChatId?: string;
    telegramBotToken?: string;
    tuiEnabled: boolean;
    notifyOnError: boolean;
    notifyOnCompletion: boolean;
    notifyOnApprovalRequired: boolean;
}
/**
 * Notification policy engine
 */
export declare class NotificationPolicyEngine {
    private preferences;
    constructor(preferences?: Partial<UserPreferences>);
    /**
     * Update user preferences
     */
    updatePreferences(prefs: Partial<UserPreferences>): void;
    /**
     * Evaluate notification policy
     */
    evaluate(context: NotificationContext): NotificationPolicy;
    /**
     * Infer severity from event name
     */
    private inferSeverity;
}
/**
 * Check if an event requires approval buttons
 */
export declare function requiresApproval(event: string): boolean;
/**
 * Check if an event is high priority
 */
export declare function isHighPriority(event: string): boolean;
//# sourceMappingURL=notification-policy.d.ts.map