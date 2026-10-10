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
	InlineKeyboardButton,
	NotificationEvent,
	NotificationPayload,
	NotificationConfig,
	NotificationChannelConfig,
	NotificationResult,
	NotificationContext,
	TelegramCallbackHandler,
} from "./types.js";
import type { ChannelAdapter } from "./base-adapter.js";
import { TelegramAdapter } from "./adapters/telegram-adapter.js";
import { buildCallbackData, CallbackActions } from "./telegram-webhook-handler.js";
import { LineAdapter } from "./adapters/line-adapter.js";
import { NtfyAdapter } from "./adapters/ntfy-adapter.js";
import { EmailAdapter } from "./adapters/email-adapter.js";
import { WebhookAdapter } from "./adapters/webhook-adapter.js";

/**
 * Pending approval request
 */
export interface PendingApproval {
	jobId: string;
	event: string;
	context: NotificationContext;
	createdAt: Date;
	resolved: boolean;
	result?: "approved" | "rejected";
}

export class NotificationCenter {
	private adapters: Map<string, ChannelAdapter> = new Map();
	private redactPatterns: RegExp[];
	/** Pending approval requests keyed by jobId */
	private pendingApprovals: Map<string, PendingApproval> = new Map();

	/**
	 * Track a new pending approval request
	 */
	trackPendingApproval(
		jobId: string,
		event: NotificationEvent,
		context: NotificationContext,
	): void {
		this.pendingApprovals.set(jobId, {
			jobId,
			event,
			context,
			createdAt: new Date(),
			resolved: false,
		});
	}

	/**
	 * Resolve a pending approval request
	 * @returns true if the request was found and resolved, false otherwise
	 */
	resolvePendingApproval(
		jobId: string,
		result: "approved" | "rejected",
	): boolean {
		const pending = this.pendingApprovals.get(jobId);
		if (!pending || pending.resolved) {
			return false;
		}
		pending.resolved = true;
		pending.result = result;
		return true;
	}

	/**
	 * Get a pending approval request
	 */
	getPendingApproval(jobId: string): PendingApproval | undefined {
		return this.pendingApprovals.get(jobId);
	}

	/**
	 * Check if a pending approval exists and is unresolved
	 */
	isPendingApproval(jobId: string): boolean {
		const pending = this.pendingApprovals.get(jobId);
		return !!pending && !pending.resolved;
	}

	/**
	 * Clear resolved pending approvals older than maxAgeMs
	 */
	cleanupResolvedApprovals(maxAgeMs = 60000): void {
		const now = Date.now();
		for (const [jobId, pending] of this.pendingApprovals.entries()) {
			if (
				pending.resolved &&
				now - pending.createdAt.getTime() > maxAgeMs
			) {
				this.pendingApprovals.delete(jobId);
			}
		}
	}

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
	 * Set callback handler for Telegram adapters
	 * Enables handling of inline keyboard button clicks (approve/reject)
	 */
	setCallbackHandler(handler: TelegramCallbackHandler): void {
		for (const [, adapter] of this.adapters) {
			if (adapter instanceof TelegramAdapter) {
				adapter.setCallbackHandler(handler);
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
		await Promise.all(
			adapterEntries.map(async ([id, adapter]) => {
				try {
					// Redact sensitive data
					const redactedPayload = this.redact(payload);
					const result = await adapter.send(redactedPayload);
					return { success: true, channel: id, result };
				} catch (error) {
					// Never crash the runtime due to notification failure
					return {
						success: false,
						channel: id,
						error: String(error),
					};
				}
			})
		).then((adapterResults) => {
			results.push(...adapterResults);
		});
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
	 * Check if any adapter is healthy (initialized and working)
	 * Unlike hasChannels(), this verifies actual health, not just config
	 */
	hasHealthyChannels(): boolean {
		for (const [, adapter] of this.adapters) {
			if (adapter.isHealthy()) {
				return true;
			}
		}
		return false;
	}

	/**
	 * List all configured channels
	 */
	listChannels(): string[] {
		return Array.from(this.adapters.keys());
	}

	/**
	 * Get Telegram bot username if configured
	 */
	getTelegramBotUsername(): string | undefined {
		const adapter = this.adapters.get("telegram");
		if (adapter instanceof TelegramAdapter) {
			return adapter.botUsername;
		}
		return undefined;
	}

	/**
	 * Get Telegram adapter for advanced operations (webhook setup, etc.)
	 */
	getTelegramAdapter(): TelegramAdapter | undefined {
		const adapter = this.adapters.get("telegram");
		if (adapter instanceof TelegramAdapter) {
			return adapter;
		}
		return undefined;
	}

	/**
	 * Set callback handler for Telegram inline keyboard button clicks
	 */
	setTelegramCallbackHandler(handler: TelegramCallbackHandler): void {
		const adapter = this.adapters.get("telegram");
		if (adapter instanceof TelegramAdapter) {
			adapter.setCallbackHandler(handler);
		}
	}

	/**
	 * Set webhook secret for Telegram updates verification
	 */
	setTelegramWebhookSecret(secret: string): void {
		const adapter = this.adapters.get("telegram");
		if (adapter instanceof TelegramAdapter) {
			adapter.setWebhookSecret(secret);
		}
	}

	/**
	 * Setup Telegram webhook for receiving updates
	 */
	async setupTelegramWebhook(webhookUrl: string): Promise<boolean> {
		const adapter = this.adapters.get("telegram");
		if (adapter instanceof TelegramAdapter) {
			return await adapter.setupWebhook(webhookUrl);
		}
		return false;
	}

	/**
	 * Send notification with interactive Yes/No buttons
	 */
	async notifyWithApproval(
		event: NotificationEvent,
		context: NotificationContext,
		options?: {
			/** Custom button labels */
			approveLabel?: string;
			rejectLabel?: string;
			/** Additional details for the message */
			additionalDetails?: Record<string, unknown>;
		},
	): Promise<NotificationResult[]> {
		const approveLabel = options?.approveLabel ?? "Yes";
		const rejectLabel = options?.rejectLabel ?? "No";

		// Build buttons
		const buttons: InlineKeyboardButton[] = [
			{ text: `\u2705 ${approveLabel}`, callbackData: buildCallbackData(CallbackActions.APPROVE, context.jobId) },
			{ text: `\u274C ${rejectLabel}`, callbackData: buildCallbackData(CallbackActions.REJECT, context.jobId) },
		];

		// Track this pending approval so callback can resolve it
		this.trackPendingApproval(context.jobId, event, context);

		// Send to each channel with buttons (Telegram only)
		const results: NotificationResult[] = [];

		for (const [id, adapter] of this.adapters.entries()) {
			if (adapter instanceof TelegramAdapter) {
				try {
					const payload = this.buildPayload(event, context, {
						enableInlineKeyboard: true,
						actionButtons: buttons,
						...(options?.additionalDetails && { additionalDetails: options.additionalDetails }),
					});
					const result = await adapter.send(payload);
					results.push(result);
				} catch (error) {
					results.push({ success: false, channel: id, error: String(error) });
				}
			}
		}

		return results;
	}

	/**
	 * Send a question that expects a text response from the user.
	 * Unlike notifyWithApproval (Yes/No buttons), this sends a plain message
	 * and waits for the user to type their response.
	 */
	async notifyWithQuestion(
		event: NotificationEvent,
		context: NotificationContext,
		options?: {
			/** Custom question to ask */
			question?: string;
			/** Hint for expected response format */
			expectedFormat?: string;
			/** Response directory for tracking */
			responseDir?: string;
		},
	): Promise<NotificationResult[]> {
		const question = options?.question ?? `Question for task ${context.jobId}`;
		const hint = options?.expectedFormat
			? `\n\nPlease reply with: ${options.expectedFormat}`
			: "\n\nPlease type your response below.";
		const fullMessage = `${question}${hint}`;

		const results: NotificationResult[] = [];

		for (const [id, adapter] of this.adapters.entries()) {
			if (adapter instanceof TelegramAdapter) {
				try {
					const payload: NotificationPayload = {
						event,
						jobId: context.jobId,
						timestamp: new Date().toISOString(),
						title: `Question from ${context.jobId}`,
						message: fullMessage,
						details: {
							waitForResponse: true,
							expectedFormat: options?.expectedFormat,
						},
					};
					const result = await adapter.sendQuestion(
						payload,
						options?.responseDir,
					);
					results.push(result);
				} catch (error) {
					results.push({ success: false, channel: id, error: String(error) });
				}
			}
		}

		return results;
	}

	/**
	 * Send interactive notification with custom buttons
	 */
	async notifyWithButtons(
		event: NotificationEvent,
		context: NotificationContext,
		buttons: Array<{ text: string; action: string; targetId: string; url?: string }>,
		options?: {
			/** Additional details for the message */
			additionalDetails?: Record<string, unknown>;
		},
	): Promise<NotificationResult[]> {
		const results: NotificationResult[] = [];

		for (const [id, adapter] of this.adapters.entries()) {
			if (adapter instanceof TelegramAdapter) {
				try {
					const formattedButtons: InlineKeyboardButton[] = buttons.map((b) => ({
						text: b.text,
						callbackData: buildCallbackData(b.action, b.targetId),
						url: b.url,
					}));

					const payload = this.buildPayload(event, context, {
						enableInlineKeyboard: true,
						actionButtons: formattedButtons,
						...(options?.additionalDetails && { additionalDetails: options.additionalDetails }),
					});
					const result = await adapter.send(payload);
					results.push(result);
				} catch (error) {
					results.push({ success: false, channel: id, error: String(error) });
				}
			}
		}

		return results;
	}

	// --- Private Methods ------------------------------------------------

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
			case "line":
				return new LineAdapter(
					config.config as import("./types.js").LineConfig,
				);
			default:
				return null;
		}
	}

	private buildPayload(
		event: NotificationEvent,
		context: NotificationContext,
		options?: {
			enableInlineKeyboard?: boolean;
			actionButtons?: InlineKeyboardButton[];
			additionalDetails?: Record<string, unknown>;
		},
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
				// Pass inline keyboard options to Telegram adapter
				...(options?.enableInlineKeyboard && { _enableInlineKeyboard: true }),
				...(options?.actionButtons && { _actionButtons: options.actionButtons }),
				...(options?.additionalDetails && options.additionalDetails),
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
			WaitingForUserInput: {
				title: "Your Input Needed",
				message: `Agent needs your input: "${requirement}"${context.error ? ` (${context.error})` : ""}`,
			},
			CodexSessionStarted: {
				title: "Codex Session Started",
				message: `Codex CLI session "${context.taskTitle ?? "new session"}" is now active`,
			},
			CodexPlanDetected: {
				title: "Codex Plan Detected",
				message: `Codex has a new plan ready for your review`,
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
			/channel[_-]?access[_-]?token["\s:=]+[^\s,}]+/gi, // LINE channel access token
			/password["\s:=]+[^\s,}]+/gi, // passwords
			/cookie["\s:=]+[^\s,}]+/gi, // cookies
			/secret["\s:=]+[^\s,}]+/gi, // secrets
			/api[_-]?key["\s:=]+[^\s,}]+/gi, // API keys
			/auth["\s:=]+[^\s,}]+/gi, // auth tokens
		];
	}
}
