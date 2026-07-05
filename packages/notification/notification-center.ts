/**
 * Notification Center — RFC-0022
 *
 * Main orchestration class for sending notifications across multiple channels.
 *
 * Security Rules (RFC-0022):
 * - Do not send raw cookies, passwords, provider tokens
 * - Redact sensitive data before sending
 * - Notification failure does not crash runtime
 */

import type {
	NotificationEvent,
	NotificationPayload,
	NotificationConfig,
	NotificationChannelConfig,
	NotificationResult,
	NotificationContext,
} from "./types.js";
import type { ChannelAdapter } from "./base-adapter.js";
import { TelegramAdapter } from "./adapters/telegram-adapter.js";
import { NtfyAdapter } from "./adapters/ntfy-adapter.js";
import { EmailAdapter } from "./adapters/email-adapter.js";
import { WebhookAdapter } from "./adapters/webhook-adapter.js";

export class NotificationCenter {
	private adapters: Map<string, ChannelAdapter> = new Map();
	private redactPatterns: RegExp[];

	constructor(config?: NotificationConfig) {
		this.redactPatterns =
			config?.redactPatterns ?? this.getDefaultRedactPatterns();

		if (config?.channels) {
			for (const channelConfig of config.channels) {
				if (channelConfig.enabled) {
					this.registerAdapter(channelConfig);
				}
			}
		}
	}

	/**
	 * Register a new adapter
	 */
	registerAdapter(config: NotificationChannelConfig): boolean {
		try {
			const adapter = this.createAdapter(config);
			if (adapter && adapter.isConfigured()) {
				this.adapters.set(config.id, adapter);
				return true;
			}
		} catch (error) {
			console.error(
				`[NotificationCenter] Failed to register adapter: ${error}`,
			);
		}
		return false;
	}

	/**
	 * Initialize all registered adapters
	 */
	async initialize(): Promise<void> {
		const adapterEntries = Array.from(this.adapters.entries());
		for (const [id, adapter] of adapterEntries) {
			try {
				const ok = await adapter.initialize();
				if (!ok) {
					console.warn(
						`[NotificationCenter] Adapter ${id} initialization failed`,
					);
				}
			} catch (error) {
				console.warn(
					`[NotificationCenter] Adapter ${id} initialization error: ${error}`,
				);
			}
		}
	}

	/**
	 * Send a notification to all configured channels
	 */
	async notify(
		event: NotificationEvent,
		context: NotificationContext,
	): Promise<NotificationResult[]> {
		const payload = this.buildPayload(event, context);
		const results: NotificationResult[] = [];

		// Send to all adapters in parallel
		const adapterEntries = Array.from(this.adapters.entries());
		const promises = adapterEntries.map(async ([id, adapter]) => {
			try {
				// Redact sensitive data
				const redactedPayload = this.redact(payload);
				const result = await adapter.send(redactedPayload);
				results.push(result);
			} catch (error) {
				// Never crash the runtime due to notification failure
				results.push({
					success: false,
					channel: id,
					error: String(error),
				});
			}
		});

		await Promise.all(promises);
		return results;
	}

	/**
	 * Send notification to a specific channel
	 */
	async notifyChannel(
		channelId: string,
		event: NotificationEvent,
		context: NotificationContext,
	): Promise<NotificationResult> {
		const adapter = this.adapters.get(channelId);
		if (!adapter) {
			return { success: false, channel: channelId, error: "Adapter not found" };
		}

		try {
			const payload = this.redact(this.buildPayload(event, context));
			return await adapter.send(payload);
		} catch (error) {
			return { success: false, channel: channelId, error: String(error) };
		}
	}

	/**
	 * Check if any notifications are configured
	 */
	hasChannels(): boolean {
		return this.adapters.size > 0;
	}

	/**
	 * List all configured channels
	 */
	listChannels(): string[] {
		return Array.from(this.adapters.keys());
	}

	// ─── Private Methods ────────────────────────────────────────────────

	private createAdapter(
		config: NotificationChannelConfig,
	): ChannelAdapter | null {
		switch (config.type) {
			case "telegram":
				return new TelegramAdapter(
					config.config as import("./types.js").TelegramConfig,
				);
			case "ntfy":
				return new NtfyAdapter(
					config.config as import("./types.js").NtfyConfig,
				);
			case "email":
				return new EmailAdapter(
					config.config as import("./types.js").EmailConfig,
				);
			case "webhook":
				return new WebhookAdapter(
					config.config as import("./types.js").WebhookConfig,
				);
			default:
				return null;
		}
	}

	private buildPayload(
		event: NotificationEvent,
		context: NotificationContext,
	): NotificationPayload {
		const { title, message } = this.getEventContent(event, context);

		return {
			event,
			jobId: context.jobId,
			timestamp: new Date().toISOString(),
			title,
			message,
			details: {
				jobId: context.jobId,
				requirement: context.requirement,
				...(context.taskId && { taskId: context.taskId }),
				...(context.taskTitle && { taskTitle: context.taskTitle }),
				...(context.error && { error: context.error }),
			},
		};
	}

	private getEventContent(
		event: NotificationEvent,
		context: NotificationContext,
	): { title: string; message: string } {
		const requirement =
			context.requirement.length > 50
				? context.requirement.slice(0, 50) + "..."
				: context.requirement;

		const map: Record<NotificationEvent, { title: string; message: string }> = {
			JobStarted: {
				title: "Job Started",
				message: `Harness job started for: "${requirement}"`,
			},
			TaskCompleted: {
				title: "Task Completed",
				message: `Task "${context.taskTitle ?? "Unknown"}" completed successfully`,
			},
			TaskFailed: {
				title: "Task Failed",
				message: `Task "${context.taskTitle ?? "Unknown"}" failed${context.error ? `: ${context.error}` : ""}`,
			},
			QuotaPaused: {
				title: "Quota Paused",
				message: `Job paused due to quota limit. Will auto-resume when quota resets.`,
			},
			ResumeScheduled: {
				title: "Resume Scheduled",
				message: `Job will resume work on: "${requirement}"`,
			},
			ContextCompacted: {
				title: "Context Compacted",
				message: `Session context was compacted to continue work on: "${requirement}"`,
			},
			OutputLimitContinued: {
				title: "Output Limit Continued",
				message: `Response was continued after hitting output token limit`,
			},
			E2EFailed: {
				title: "E2E Test Failed",
				message: `End-to-end tests failed for job: "${requirement}"`,
			},
			HumanReviewNeeded: {
				title: "Human Review Needed",
				message: `Job blocked. Please review and take action.`,
			},
			ReadyForClient: {
				title: "Ready for Review",
				message: `Job completed successfully and ready for your review: "${requirement}"`,
			},
			JobCancelled: {
				title: "Job Cancelled",
				message: `Job was cancelled: "${requirement}"`,
			},
			Error: {
				title: "Runtime Error",
				message: `An error occurred${context.error ? `: ${context.error}` : ""}`,
			},
		};

		return map[event] ?? { title: event, message: `Event: ${event}` };
	}

	private redact(payload: NotificationPayload): NotificationPayload {
		const details = payload.details ? { ...payload.details } : {};

		// Redact sensitive patterns
		for (const pattern of this.redactPatterns) {
			for (const [key, value] of Object.entries(details)) {
				if (typeof value === "string" && pattern.test(value)) {
					details[key] = "[REDACTED]";
				}
			}
		}

		return { ...payload, details };
	}

	private getDefaultRedactPatterns(): RegExp[] {
		return [
			/Bearer\s+[\w-]+/gi, // Bearer tokens
			/password["\s:=]+[^\s,}]+/gi, // passwords
			/cookie["\s:=]+[^\s,}]+/gi, // cookies
			/secret["\s:=]+[^\s,}]+/gi, // secrets
			/api[_-]?key["\s:=]+[^\s,}]+/gi, // API keys
			/auth["\s:=]+[^\s,}]+/gi, // auth tokens
		];
	}
}
