/**
 * Observability Package - Alert Engine
 *
 * Alert rule evaluation and alerting.
 */
import type { Alert, AlertRule } from "./types.js";
import { Logger } from "./logger.js";
export declare class AlertEngine {
    private readonly rules;
    private readonly activeAlerts;
    private readonly alertHistory;
    private readonly logger;
    constructor(logger?: Logger, _maxHistory?: number);
    /**
     * Register an alert rule
     */
    registerRule(rule: AlertRule): void;
    /**
     * Unregister an alert rule
     */
    unregisterRule(name: string): void;
    /**
     * Get a rule by name
     */
    getRule(name: string): AlertRule | undefined;
    /**
     * Enable or disable a rule
     */
    setRuleEnabled(name: string, enabled: boolean): void;
    /**
     * Evaluate all rules
     */
    evaluate(metrics: Record<string, number>): Promise<Alert[]>;
    /**
     * Evaluate a single condition
     */
    private evaluateCondition;
    /**
     * Create an alert from a rule
     */
    private createAlert;
    /**
     * Format alert message
     */
    private formatAlertMessage;
    /**
     * Trigger alert actions
     */
    private triggerActions;
    /**
     * Execute a single action
     */
    private executeAction;
    /**
     * Log an alert
     */
    private logAlert;
    /**
     * Send a notification
     */
    private sendNotification;
    /**
     * Send a webhook
     */
    private sendWebhook;
    /**
     * Execute a command
     */
    private executeCommand;
    /**
     * Get active alerts
     */
    getActiveAlerts(): Alert[];
    /**
     * Get alert history
     */
    getAlertHistory(limit?: number): Alert[];
    /**
     * Clear alert history
     */
    clearHistory(): void;
    /**
     * List all rules
     */
    listRules(): AlertRule[];
    /**
     * Get rule count
     */
    getRuleCount(): {
        total: number;
        enabled: number;
        disabled: number;
    };
}
/**
 * Create an alert engine
 */
export declare function createAlertEngine(logger?: Logger): AlertEngine;
//# sourceMappingURL=alerts.d.ts.map