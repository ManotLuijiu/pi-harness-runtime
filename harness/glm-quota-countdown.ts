/**
 * GLM Quota Countdown — Robust countdown system for GLM quota exhaustion
 *
 * Features:
 * - Stores reset time when 429 error is detected
 * - Runs countdown timer with periodic status updates
 * - Sends notifications at 15min, 5min, 1min intervals
 * - Updates TUI footer with countdown every minute
 * - Auto-triggers resume when reset time arrives
 *
 * Flow:
 *   429 Error Detected
 *     → parseResetTime() extracts ISO timestamp from error message
 *     → startCountdown() begins monitoring
 *     → Every tick: updateFooterStatus() refreshes TUI
 *     → At intervals: sendNotification() alerts user
 *     → At reset: triggerAutoResume() continues the job
 */

import type { JobStateMachine } from "./job-state-machine.js";
import type { MirrorStore } from "../mirror.js";
import type { NotificationCenter } from "../packages/notification/dist/notification-center.js";

/** Notification intervals before reset (in seconds) */
const NOTIFICATION_INTERVALS = [
	15 * 60, // 15 minutes
	5 * 60, // 5 minutes
	60, // 1 minute
] as const;

/** How often to update the TUI footer (in seconds) */
const FOOTER_UPDATE_INTERVAL_SECONDS = 60; // Every minute

/** Buffer before reset time to attempt resume (ms) */
const RESUME_BUFFER_MS = 10_000; // 10 seconds

/** Minimum delay before auto-resume (ms) */
const MIN_RESUME_DELAY_MS = 5_000; // 5 seconds

export interface GLMQuotaCountdownState {
	/** Job ID this countdown is for */
	jobId: string;
	/** When the quota resets (ISO string) */
	resetAt: string;
	/** When the quota resets (epoch ms) */
	resetAtEpoch: number;
	/** When countdown started */
	startedAt: string;
	/** Total seconds until reset */
	totalSeconds: number;
	/** Last notification sent (type) */
	lastNotificationSent?: "15min" | "5min" | "1min" | "reset";
	/** Auto-resume scheduled */
	autoResumeScheduled: boolean;
}

export interface CountdownTickEvent {
	jobId: string;
	remainingSeconds: number;
	remainingFormatted: string;
	nextNotificationIn?: number;
	isResetTime: boolean;
}

type CountdownCallback = (event: CountdownTickEvent) => void;

/** Regex patterns to extract reset time from GLM 429 errors */
const GLM_RESET_TIME_PATTERNS = [
	// "Your limit will reset at 2026-08-25 01:47:16"
	/reset at (\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})/i,
	// "reset at 2026-08-25 01:47:16" (alternative format)
	/reset\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})/i,
	// "will reset at 01:47:16" (date from context)
	/will reset at (\d{2}:\d{2}:\d{2})/i,
];

/**
 * Parse reset time from GLM 429 error message
 * Returns ISO string or null if not found
 */
export function parseGLMResetTime(errorMessage: string): string | null {
	// Try full datetime patterns first
	for (const pattern of GLM_RESET_TIME_PATTERNS.slice(0, 2)) {
		const match = errorMessage.match(pattern);
		if (match) {
			const datetimeStr = match[1];
			// Check if it's a full ISO datetime
			if (datetimeStr.includes("-")) {
				// Already has date, just ensure it's parseable
				const date = new Date(datetimeStr.replace(" ", "T"));
				if (!isNaN(date.getTime())) {
					return date.toISOString();
				}
			}
		}
	}

	// Try time-only pattern - need to determine the date
	const timeMatch = errorMessage.match(/(\d{2}):(\d{2}):(\d{2})/);
	if (timeMatch) {
		const [, hour, minute, second] = timeMatch;
		const now = new Date();
		const resetTime = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
			parseInt(hour, 10),
			parseInt(minute, 10),
			parseInt(second, 10),
			0,
		);

		// If time has passed today, assume tomorrow
		if (resetTime <= now) {
			resetTime.setDate(resetTime.getDate() + 1);
		}

		return resetTime.toISOString();
	}

	return null;
}

/**
 * Format seconds into human-readable countdown string
 */
export function formatCountdown(seconds: number): string {
	if (seconds <= 0) return "RESET NOW";

	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0 || days > 0) parts.push(`${hours}h`);
	if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
	parts.push(`${secs}s`);

	return parts.join(" ");
}

/**
 * GLM Quota Countdown Manager
 *
 * Manages countdown timers for GLM quota exhaustion, providing:
 * - Real-time countdown display in TUI
 * - Periodic notifications before reset
 * - Auto-resume capability
 */
export class GLMQuotaCountdown {
	private activeCountdowns: Map<string, GLMQuotaCountdownState> = new Map();
	private timers: Map<string, NodeJS.Timeout> = new Map();
	private tickCallbacks: Set<CountdownCallback> = new Set();
	private notificationCenter: NotificationCenter | null = null;
	private jobContext: { jobId: string; requirement: string } | null = null;

	/**
	 * Set notification center for sending alerts
	 */
	setNotificationCenter(center: NotificationCenter): void {
		this.notificationCenter = center;
	}

	/**
	 * Set job context for notifications
	 */
	setJobContext(jobId: string, requirement: string): void {
		this.jobContext = { jobId, requirement };
	}

	/**
	 * Register a tick callback (e.g., for TUI footer updates)
	 */
	onTick(callback: CountdownCallback): () => void {
		this.tickCallbacks.add(callback);
		return () => this.tickCallbacks.delete(callback);
	}

	/**
	 * Check if there's an active countdown for a job
	 */
	hasCountdown(jobId: string): boolean {
		return this.activeCountdowns.has(jobId);
	}

	/**
	 * Get current countdown state for a job
	 */
	getCountdown(jobId: string): GLMQuotaCountdownState | null {
		return this.activeCountdowns.get(jobId) ?? null;
	}

	/**
	 * Get all active countdowns
	 */
	getAllCountdowns(): GLMQuotaCountdownState[] {
		return Array.from(this.activeCountdowns.values());
	}

	/**
	 * Start a countdown for a job when GLM quota is exhausted
	 *
	 * @param jobId - Job identifier
	 * @param resetAt - ISO timestamp when quota resets
	 * @param mirrorStore - MirrorStore for updating quota status
	 * @param machine - JobStateMachine for auto-resume
	 */
	async startCountdown(
		jobId: string,
		resetAt: string,
		mirrorStore: MirrorStore,
		machine: JobStateMachine,
	): Promise<GLMQuotaCountdownState> {
		// Cancel any existing countdown for this job
		this.cancelCountdown(jobId);

		const resetAtEpoch = new Date(resetAt).getTime();
		const now = Date.now();
		const totalSeconds = Math.max(0, Math.floor((resetAtEpoch - now) / 1000));

		const state: GLMQuotaCountdownState = {
			jobId,
			resetAt,
			resetAtEpoch,
			startedAt: new Date().toISOString(),
			totalSeconds,
			autoResumeScheduled: false,
		};

		this.activeCountdowns.set(jobId, state);

		// Update mirror store with reset time
		this.updateMirrorWithResetTime(jobId, resetAt, resetAtEpoch, mirrorStore);

		// Schedule the countdown timer
		this.scheduleCountdown(jobId, state, mirrorStore, machine);

		// Emit initial tick
		this.emitTick({
			jobId,
			remainingSeconds: totalSeconds,
			remainingFormatted: formatCountdown(totalSeconds),
			isResetTime: totalSeconds <= 0,
		});

		console.log(
			`[GLMQuotaCountdown] Started countdown for job ${jobId}: ${formatCountdown(totalSeconds)} until reset at ${resetAt}`,
		);

		return state;
	}

	/**
	 * Start countdown from a 429 error message
	 */
	async startFromError(
		jobId: string,
		errorMessage: string,
		mirrorStore: MirrorStore,
		machine: JobStateMachine,
	): Promise<GLMQuotaCountdownState | null> {
		const resetAt = parseGLMResetTime(errorMessage);
		if (!resetAt) {
			console.warn(
				`[GLMQuotaCountdown] Could not parse reset time from error for job ${jobId}`,
			);
			return null;
		}

		return this.startCountdown(jobId, resetAt, mirrorStore, machine);
	}

	/**
	 * Cancel countdown for a job
	 */
	cancelCountdown(jobId: string): void {
		const existingTimer = this.timers.get(jobId);
		if (existingTimer) {
			clearTimeout(existingTimer);
			this.timers.delete(jobId);
		}
		this.activeCountdowns.delete(jobId);
		console.log(`[GLMQuotaCountdown] Cancelled countdown for job ${jobId}`);
	}

	/**
	 * Update mirror store with reset time info
	 */
	private updateMirrorWithResetTime(
		jobId: string,
		resetAt: string,
		resetAtEpoch: number,
		mirrorStore: MirrorStore,
	): void {
		try {
			const record = mirrorStore.readProvider("glm") ?? {
				synced_at: new Date().toISOString(),
				provider: "glm",
				source: "tui-signal" as const,
				exhausted: true,
				limitType: "tokens" as const,
				resets_at: resetAt,
			};

			// Update with exhaustion info
			const updated = {
				...record,
				synced_at: new Date().toISOString(),
				provider: "glm",
				source: (record.source || "tui-signal") as
					| "scrape"
					| "tui-signal"
					| "manual",
				exhausted: true,
				limitType: record.limitType || ("tokens" as const),
				h5_used_pct: 100,
				h5_resets_at: resetAt,
				h5_resets_at_epoch: resetAtEpoch,
				resets_at: resetAt,
			};

			mirrorStore.writeProvider("glm", updated);
			console.log(
				`[GLMQuotaCountdown] Updated mirror with reset time: ${resetAt}`,
			);
		} catch (error) {
			console.error(`[GLMQuotaCountdown] Failed to update mirror: ${error}`);
		}
	}

	/**
	 * Schedule the countdown timer
	 */
	private scheduleCountdown(
		jobId: string,
		state: GLMQuotaCountdownState,
		mirrorStore: MirrorStore,
		machine: JobStateMachine,
	): void {
		const tickIntervalMs = FOOTER_UPDATE_INTERVAL_SECONDS * 1000;

		// Schedule periodic ticks
		const tickTimer = setInterval(() => {
			this.handleTick(jobId, state, mirrorStore, machine);
		}, tickIntervalMs);

		this.timers.set(jobId, tickTimer);

		// Calculate time until reset
		const now = Date.now();
		const timeUntilReset = state.resetAtEpoch - now;

		// Schedule auto-resume just before reset
		if (timeUntilReset > RESUME_BUFFER_MS + MIN_RESUME_DELAY_MS) {
			const resumeDelay = Math.max(
				timeUntilReset - RESUME_BUFFER_MS,
				MIN_RESUME_DELAY_MS,
			);

			const resumeTimer = setTimeout(async () => {
				await this.triggerAutoResume(jobId, state, machine, mirrorStore);
			}, resumeDelay);

			this.timers.set(`${jobId}:resume`, resumeTimer);
			state.autoResumeScheduled = true;
		} else if (timeUntilReset > 0) {
			// Reset time is soon, schedule immediate resume
			const resumeTimer = setTimeout(async () => {
				await this.triggerAutoResume(jobId, state, machine, mirrorStore);
			}, timeUntilReset);

			this.timers.set(`${jobId}:resume`, resumeTimer);
			state.autoResumeScheduled = true;
		}
	}

	/**
	 * Handle a countdown tick
	 */
	private handleTick(
		jobId: string,
		state: GLMQuotaCountdownState,
		mirrorStore: MirrorStore,
		machine: JobStateMachine,
	): void {
		const now = Date.now();
		const remainingMs = state.resetAtEpoch - now;
		const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

		// Check if it's reset time
		if (remainingMs <= 0) {
			this.triggerAutoResume(jobId, state, machine, mirrorStore);
			return;
		}

		// Check for notification intervals
		this.checkNotificationIntervals(state, remainingSeconds);

		// Emit tick for TUI updates
		const nextNotificationIn = this.getNextNotificationIn(
			state,
			remainingSeconds,
		);
		this.emitTick({
			jobId,
			remainingSeconds,
			remainingFormatted: formatCountdown(remainingSeconds),
			nextNotificationIn,
			isResetTime: false,
		});

		// Update countdown state
		state.totalSeconds = remainingSeconds;
	}

	/**
	 * Check if we need to send a notification
	 */
	private checkNotificationIntervals(
		state: GLMQuotaCountdownState,
		remainingSeconds: number,
	): void {
		for (const interval of NOTIFICATION_INTERVALS) {
			if (
				remainingSeconds <= interval &&
				(!state.lastNotificationSent ||
					this.isNewerNotification(state.lastNotificationSent, interval))
			) {
				this.sendCountdownNotification(state.jobId, remainingSeconds, interval);
				state.lastNotificationSent = this.getNotificationType(interval);
				break;
			}
		}
	}

	/**
	 * Determine notification type from interval
	 */
	private getNotificationType(
		interval: (typeof NOTIFICATION_INTERVALS)[number],
	): "15min" | "5min" | "1min" | "reset" {
		switch (interval) {
			case 15 * 60:
				return "15min";
			case 5 * 60:
				return "5min";
			case 60:
				return "1min";
			default:
				return "reset";
		}
	}

	/**
	 * Check if a notification type is "newer" (more urgent)
	 */
	private isNewerNotification(
		current: "15min" | "5min" | "1min" | "reset",
		newInterval: number,
	): boolean {
		const priority: Record<string, number> = {
			"15min": 3,
			"5min": 2,
			"1min": 1,
			reset: 0,
		};
		const newType = this.getNotificationType(
			newInterval as (typeof NOTIFICATION_INTERVALS)[number],
		);
		return priority[newType] < priority[current];
	}

	/**
	 * Get seconds until next notification
	 */
	private getNextNotificationIn(
		state: GLMQuotaCountdownState,
		remainingSeconds: number,
	): number | undefined {
		for (const interval of NOTIFICATION_INTERVALS) {
			if (remainingSeconds <= interval && remainingSeconds > interval - 60) {
				return remainingSeconds;
			}
		}
		return undefined;
	}

	/**
	 * Send a countdown notification
	 */
	private async sendCountdownNotification(
		jobId: string,
		remainingSeconds: number,
		interval: number,
	): Promise<void> {
		if (!this.notificationCenter) {
			console.log(
				`[GLMQuotaCountdown] Notification: ${formatCountdown(remainingSeconds)} until GLM quota reset`,
			);
			return;
		}

		const minutes = Math.floor(remainingSeconds / 60);
		const label =
			interval === 15 * 60
				? "15 minutes"
				: interval === 5 * 60
					? "5 minutes"
					: "1 minute";

		try {
			await this.notificationCenter.notify("QuotaPaused", {
				jobId: this.jobContext?.jobId ?? jobId,
				requirement: this.jobContext?.requirement ?? "GLM Quota",
				error: `GLM quota reset in ${label} (${formatCountdown(remainingSeconds)}). Auto-resume pending.`,
			});
			console.log(
				`[GLMQuotaCountdown] Sent ${label} notification for job ${jobId}`,
			);
		} catch (error) {
			console.error(`[GLMQuotaCountdown] Failed to send notification: ${error}`);
		}
	}

	/**
	 * Trigger auto-resume when quota resets
	 */
	private async triggerAutoResume(
		jobId: string,
		state: GLMQuotaCountdownState,
		machine: JobStateMachine,
		mirrorStore: MirrorStore,
	): Promise<void> {
		console.log(`[GLMQuotaCountdown] Triggering auto-resume for job ${jobId}`);

		// Clear timers
		this.cancelCountdown(jobId);

		// Send final notification
		await this.sendCountdownNotification(jobId, 0, 0);

		// Attempt to transition machine back to running
		try {
			const checkpoint = machine.getCheckpoint();
			if (checkpoint && checkpoint.status === "paused_quota") {
				const result = await machine.transition("running");
				if (result.success) {
					console.log(`[GLMQuotaCountdown] Job ${jobId} auto-resumed successfully`);

					// Update mirror to clear exhaustion
					const record = mirrorStore.readProvider("glm");
					if (record) {
						mirrorStore.writeProvider("glm", {
							...record,
							synced_at: new Date().toISOString(),
							exhausted: false,
							h5_used_pct: 0,
							resets_at: undefined,
						});
					}

					// Emit final tick
					this.emitTick({
						jobId,
						remainingSeconds: 0,
						remainingFormatted: "RESET - RESUMING",
						isResetTime: true,
					});
				} else {
					console.error(`[GLMQuotaCountdown] Auto-resume failed: ${result.error}`);
				}
			}
		} catch (error) {
			console.error(`[GLMQuotaCountdown] Auto-resume error: ${error}`);
		}
	}

	/**
	 * Emit tick to all callbacks
	 */
	private emitTick(event: CountdownTickEvent): void {
		for (const callback of this.tickCallbacks) {
			try {
				callback(event);
			} catch (error) {
				console.error(`[GLMQuotaCountdown] Tick callback error: ${error}`);
			}
		}
	}

	/**
	 * Clean up all timers
	 */
	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
			clearInterval(timer);
		}
		this.timers.clear();
		this.activeCountdowns.clear();
		this.tickCallbacks.clear();
	}
}

/** Singleton instance for global access */
let globalCountdown: GLMQuotaCountdown | null = null;

export function getGLMQuotaCountdown(): GLMQuotaCountdown {
	if (!globalCountdown) {
		globalCountdown = new GLMQuotaCountdown();
	}
	return globalCountdown;
}
