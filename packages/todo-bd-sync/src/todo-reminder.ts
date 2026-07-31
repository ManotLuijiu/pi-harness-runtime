/**
 * todo-reminder.ts - Inject reminders to continue remaining todos
 *
 * ARCHITECTURE NOTES:
 * - Reminders are DISABLED by default (Phase 1 emergency containment)
 *   until proper scoping is implemented.
 * - Triggers are narrowed: only after agent_end, not every bash command.
 * - Deduplication is by content hash, not just time.
 * - Source is scoped to sync-layer-mapped tasks only.
 *
 * This module does NOT modify the overlay (it works fine).
 * It ONLY injects reminders into the LLM context when todos remain.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execBdCommand } from "./sync.js";

/**
 * Default reminder template
 */
const DEFAULT_REMINDER_TEMPLATE = `
Remaining todos detected:
{summary}

Please continue with the next pending task or ask the user which to prioritize.
`.trim();

/**
 * Configuration for todo reminder
 */
export interface TodoReminderConfig {
	/** Auto-inject reminder on agent_end (default: FALSE — containment) */
	autoRemind?: boolean;
	/** Custom reminder template (default: built-in) */
	template?: string;
	/** Minimum pending tasks to trigger reminder (default: 1) */
	minPendingTasks?: number;
	/** Deliver reminder as: "steer" | "followUp" (default: "steer") */
	deliverAs?: "steer" | "followUp";
}

/**
 * Default configuration
 * NOTE: autoRemind is FALSE by default — Phase 1 emergency containment.
 * Enable only after proper task scoping is in place.
 */
const DEFAULT_CONFIG: Required<TodoReminderConfig> = {
	autoRemind: false, // DISABLED by default — see bug report
	template: DEFAULT_REMINDER_TEMPLATE,
	minPendingTasks: 1,
	deliverAs: "steer", // steer does NOT append to transcript
};

/**
 * Create a todo reminder instance
 */
export function createTodoReminder(
	pi: ExtensionAPI,
	config: TodoReminderConfig = {},
): TodoReminder {
	const finalConfig = { ...DEFAULT_CONFIG, ...config };
	return new TodoReminder(pi, finalConfig);
}

/**
 * Generate a stable content hash for deduplication
 */
function contentHash(tasks: TrackedTask[]): string {
	const ids = tasks.map((t) => t.id).sort().join("|");
	// Simple non-crypto hash — we only need dedup, not security
	let hash = 0;
	for (let i = 0; i < ids.length; i++) {
		hash = (hash * 31 + ids.charCodeAt(i)) & 0xffffffff;
	}
	return `t${Math.abs(hash).toString(16)}`;
}

/**
 * A task that is tracked by the sync layer
 */
interface TrackedTask {
	id: string;
	title: string;
	status: string;
}

/**
 * TodoReminder class — injects reminders when todos remain.
 *
 * Key design decisions:
 * 1. DISABLED by default (autoRemind: false) — Phase 1 containment
 * 2. Deduplication by content hash, not just time
 * 3. Narrow trigger: only agent_end, never generic bash
 * 4. deliverAs: "steer" avoids transcript growth
 */
export class TodoReminder {
	private pi: ExtensionAPI;
	private config: Required<TodoReminderConfig>;
	private lastReminderAt = 0;
	private lastDeliveredHash = "";

	constructor(pi: ExtensionAPI, config: Required<TodoReminderConfig>) {
		this.pi = pi;
		this.config = config;
	}

	/**
	 * Start the reminder system
	 */
	start(): void {
		if (!this.config.autoRemind) {
			return;
		}

		// Only trigger on agent_end — not on every bash command.
		// Bash triggers were too broad and caused spam during analysis sessions.
		this.pi.on("agent_end", async () => {
			await this.checkAndRemind();
		});
	}

	/**
	 * Check if reminders should be sent and send them
	 */
	private async checkAndRemind(): Promise<void> {
		try {
			const remaining = this.getTrackedTodos();

			if (remaining.length < this.config.minPendingTasks) {
				return;
			}

			// Content-based deduplication — skip if exact same set already delivered
			const hash = contentHash(remaining);
			if (hash === this.lastDeliveredHash) {
				return;
			}

			this.sendReminder(remaining);
			this.lastReminderAt = Date.now();
			this.lastDeliveredHash = hash;
		} catch (e) {
			// Non-fatal - reminders are best-effort
			console.warn("[todo-reminder] Failed to check todos:", e);
		}
	}

	/**
	 * Get remaining (pending/in-progress) todos from bd.
	 *
	 * NOTE: This returns ALL open bd issues, not just mapped ones.
	 * When the mapping registry is integrated, this should be scoped.
	 */
	private getTrackedTodos(): TrackedTask[] {
		try {
			const output = execBdCommand("bd ready --json");
			const issues = JSON.parse(output);
			return issues
				.filter(
					(issue: Record<string, unknown>) =>
						issue.status !== "closed" && issue.status !== "done",
				)
				.map((issue: Record<string, unknown>) => ({
					id: issue.id as string,
					title: issue.title as string,
					status: issue.status as string,
				}));
		} catch {
			return [];
		}
	}

	/**
	 * Format the reminder message
	 */
	private formatReminder(remaining: TrackedTask[]): string {
		const summary = remaining
			.map((t) => `[${t.id}] ${t.title} (${t.status})`)
			.join("\n");

		return this.config.template.replace("{summary}", summary);
	}

	/**
	 * Send the reminder to the LLM
	 */
	private sendReminder(remaining: TrackedTask[]): void {
		const message = this.formatReminder(remaining);

		try {
			this.pi.sendUserMessage(message, {
				deliverAs: this.config.deliverAs,
			});
		} catch (e) {
			console.warn("[todo-reminder] Failed to send reminder:", e);
		}
	}

	/**
	 * Manually trigger a reminder (for slash command)
	 */
	async triggerNow(): Promise<void> {
		await this.checkAndRemind();
	}

	/**
	 * Get current remaining count
	 */
	getRemainingCount(): number {
		return this.getTrackedTodos().length;
	}
}

/**
 * Create a reminder with custom todos source (for tighter scoping)
 * @param pi - Extension API
 * @param getRemaining - Function that returns remaining todos
 * @param config - Reminder config
 */
export function createCustomReminder(
	pi: ExtensionAPI,
	getRemaining: () => TrackedTask[],
	config: TodoReminderConfig = {},
): CustomTodoReminder {
	return new CustomTodoReminder(pi, getRemaining, config);
}

/**
 * Custom reminder with injectable todos source.
 * Use this to scope reminders to only mapped/created tasks.
 */
class CustomTodoReminder {
	private pi: ExtensionAPI;
	private getRemaining: () => TrackedTask[];
	private config: Required<TodoReminderConfig>;
	private lastReminderAt = 0;
	private lastDeliveredHash = "";

	constructor(
		pi: ExtensionAPI,
		getRemaining: () => TrackedTask[],
		config: TodoReminderConfig,
	) {
		this.pi = pi;
		this.getRemaining = getRemaining;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	start(): void {
		if (!this.config.autoRemind) return;

		// Only trigger on agent_end — not on every bash command
		this.pi.on("agent_end", async () => {
			await this.checkAndRemind();
		});
	}

	private async checkAndRemind(): Promise<void> {
		try {
			const remaining = this.getRemaining();
			if (remaining.length < this.config.minPendingTasks) return;

			// Content-based deduplication
			const hash = contentHash(remaining);
			if (hash === this.lastDeliveredHash) return;

			this.sendReminder(remaining);
			this.lastReminderAt = Date.now();
			this.lastDeliveredHash = hash;
		} catch (e) {
			console.warn("[todo-reminder] Failed to check todos:", e);
		}
	}

	private formatReminder(remaining: TrackedTask[]): string {
		const summary = remaining
			.map((t) => `[${t.id}] ${t.title} (${t.status})`)
			.join("\n");

		return this.config.template.replace("{summary}", summary);
	}

	private sendReminder(remaining: TrackedTask[]): void {
		const message = this.formatReminder(remaining);

		try {
			this.pi.sendUserMessage(message, {
				deliverAs: this.config.deliverAs,
			});
		} catch (e) {
			console.warn("[todo-reminder] Failed to send reminder:", e);
		}
	}

	async triggerNow(): Promise<void> {
		await this.checkAndRemind();
	}

	getRemainingCount(): number {
		return this.getRemaining().length;
	}
}
