/**
 * Observability Package - Alert Engine
 *
 * Alert rule evaluation and alerting.
 */

import type { Alert, AlertAction, AlertCondition, AlertRule } from "./types.js";
import { Logger } from "./logger.js";

// ─── Alert Engine Class ─────────────────────────────────────────────────

export class AlertEngine {
	private readonly rules: Map<string, AlertRule> = new Map();
	private readonly activeAlerts: Map<string, Alert> = new Map();
	private readonly alertHistory: Alert[] = [];
	private readonly logger: Logger;

	constructor(logger?: Logger, _maxHistory = 1000) {
		this.logger = logger ?? new Logger({ level: "warn" });
	}

	/**
	 * Register an alert rule
	 */
	registerRule(rule: AlertRule): void {
		this.rules.set(rule.name, { ...rule, enabled: rule.enabled ?? true });
		this.logger.debug(`Alert rule registered: ${rule.name}`);
	}

	/**
	 * Unregister an alert rule
	 */
	unregisterRule(name: string): void {
		this.rules.delete(name);
		this.logger.debug(`Alert rule unregistered: ${name}`);
	}

	/**
	 * Get a rule by name
	 */
	getRule(name: string): AlertRule | undefined {
		return this.rules.get(name);
	}

	/**
	 * Enable or disable a rule
	 */
	setRuleEnabled(name: string, enabled: boolean): void {
		const rule = this.rules.get(name);
		if (rule) {
			rule.enabled = enabled;
		}
	}

	/**
	 * Evaluate all rules
	 */
	async evaluate(metrics: Record<string, number>): Promise<Alert[]> {
		const alerts: Alert[] = [];

		for (const rule of this.rules.values()) {
			if (!rule.enabled) continue;

			const fired = this.evaluateCondition(rule.condition, metrics);

			if (fired) {
				// Check cooldown
				const existingAlert = this.activeAlerts.get(rule.name);
				if (existingAlert) {
					const cooldownEnd =
						new Date(existingAlert.triggeredAt).getTime() + rule.cooldown;
					if (Date.now() < cooldownEnd) {
						continue; // Still in cooldown
					}
				}

				const alert = this.createAlert(rule);
				alerts.push(alert);
				this.activeAlerts.set(rule.name, alert);
			} else {
				// Resolve existing alert
				const existingAlert = this.activeAlerts.get(rule.name);
				if (existingAlert && existingAlert.fired) {
					existingAlert.fired = false;
					existingAlert.resolvedAt = new Date().toISOString();
				}
			}
		}

		// Trigger actions for new alerts
		for (const alert of alerts) {
			await this.triggerActions(alert);
		}

		return alerts;
	}

	/**
	 * Evaluate a single condition
	 */
	private evaluateCondition(
		condition: AlertCondition,
		metrics: Record<string, number>,
	): boolean {
		switch (condition.type) {
			case "threshold": {
				const value = metrics[condition.metric] ?? 0;
				switch (condition.operator) {
					case ">":
						return value > condition.value;
					case "<":
						return value < condition.value;
					case ">=":
						return value >= condition.value;
					case "<=":
						return value <= condition.value;
					case "==":
						return value === condition.value;
					default:
						return false;
				}
			}

			case "rate": {
				// Rate is typically calculated over a window
				// For simplicity, we just check if the metric exists
				const value = metrics[condition.metric] ?? 0;
				return value > condition.threshold;
			}

			case "error_rate": {
				// Error rate check - would need additional context
				const value = metrics[`${condition.component}_errors_total`] ?? 0;
				const total = metrics[`${condition.component}_total`] ?? 1;
				const rate = total > 0 ? value / total : 0;
				return rate > condition.threshold;
			}

			default:
				return false;
		}
	}

	/**
	 * Create an alert from a rule
	 */
	private createAlert(rule: AlertRule): Alert {
		return {
			ruleName: rule.name,
			severity: rule.severity,
			message: this.formatAlertMessage(rule),
			triggeredAt: new Date().toISOString(),
			fired: true,
		};
	}

	/**
	 * Format alert message
	 */
	private formatAlertMessage(rule: AlertRule): string {
		switch (rule.condition.type) {
			case "threshold":
				return `${rule.name}: ${rule.condition.metric} ${rule.condition.operator} ${rule.condition.value}`;
			case "rate":
				return `${rule.name}: ${rule.condition.metric} rate > ${rule.condition.threshold}`;
			case "error_rate":
				return `${rule.name}: ${rule.condition.component} error rate > ${rule.condition.threshold}`;
			default:
				return rule.name;
		}
	}

	/**
	 * Trigger alert actions
	 */
	private async triggerActions(alert: Alert): Promise<void> {
		const rule = this.rules.get(alert.ruleName);
		if (!rule) return;

		for (const action of rule.actions) {
			await this.executeAction(action, alert);
		}
	}

	/**
	 * Execute a single action
	 */
	private async executeAction(
		action: AlertAction,
		alert: Alert,
	): Promise<void> {
		switch (action.type) {
			case "log":
				this.logAlert(alert, action.level);
				break;

			case "notify":
				await this.sendNotification(alert, action.channel, action.message);
				break;

			case "webhook":
				await this.sendWebhook(alert, action);
				break;

			case "execute":
				await this.executeCommand(alert, action.command);
				break;
		}
	}

	/**
	 * Log an alert
	 */
	private logAlert(alert: Alert, level: string): void {
		const message = `[ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`;

		switch (level) {
			case "debug":
				this.logger.debug(message);
				break;
			case "info":
				this.logger.info(message);
				break;
			case "warn":
				this.logger.warn(message);
				break;
			case "error":
				this.logger.error(message);
				break;
			case "fatal":
				this.logger.fatal(message);
				break;
			default:
				this.logger.warn(message);
		}
	}

	/**
	 * Send a notification
	 */
	private async sendNotification(
		alert: Alert,
		channel: string,
		message: string,
	): Promise<void> {
		// In a real implementation, this would send to Slack, PagerDuty, etc.
		this.logger.info(
			`Notification to ${channel}: ${message} - ${alert.message}`,
		);
	}

	/**
	 * Send a webhook
	 */
	private async sendWebhook(
		alert: Alert,
		action: { url: string; method?: string; headers?: Record<string, string> },
	): Promise<void> {
		try {
			const response = (await fetch(action.url, {
				method: action.method ?? "POST",
				headers: {
					"Content-Type": "application/json",
					...action.headers,
				},
				body: JSON.stringify({
					alert,
					timestamp: new Date().toISOString(),
				}),
			})) as Response & { ok: boolean; status: number };

			if (!response.ok) {
				this.logger.error(`Webhook failed: ${response.status}`);
			}
		} catch (error) {
			this.logger.error(
				"Webhook error",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Execute a command
	 */
	private async executeCommand(alert: Alert, command: string): Promise<void> {
		// In a real implementation, this would run a command
		this.logger.info(
			`Executing command: ${command} for alert ${alert.ruleName}`,
		);
	}

	/**
	 * Get active alerts
	 */
	getActiveAlerts(): Alert[] {
		return Array.from(this.activeAlerts.values()).filter((a) => a.fired);
	}

	/**
	 * Get alert history
	 */
	getAlertHistory(limit?: number): Alert[] {
		const history = [...this.alertHistory].reverse();
		if (limit) {
			return history.slice(0, limit);
		}
		return history;
	}

	/**
	 * Clear alert history
	 */
	clearHistory(): void {
		this.alertHistory.length = 0;
	}

	/**
	 * List all rules
	 */
	listRules(): AlertRule[] {
		return Array.from(this.rules.values());
	}

	/**
	 * Get rule count
	 */
	getRuleCount(): { total: number; enabled: number; disabled: number } {
		let enabled = 0;
		let disabled = 0;

		for (const rule of this.rules.values()) {
			if (rule.enabled) {
				enabled++;
			} else {
				disabled++;
			}
		}

		return {
			total: this.rules.size,
			enabled,
			disabled,
		};
	}
}

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Create an alert engine
 */
export function createAlertEngine(logger?: Logger): AlertEngine {
	return new AlertEngine(logger);
}
