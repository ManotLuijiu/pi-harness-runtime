/**
 * todo-reminder.ts - Inject reminders to continue remaining todos
 *
 * ARCHITECTURE NOTES:
 * - Reminders are DISABLED by default (Phase 1 emergency containment)
 *   until proper scoping is implemented.
 * - Triggers are narrowed: only after agent_end, not every bash command.
 * - Deduplication is persistent via file-based hash (survives process restart).
 * - Source is scoped to sync-layer-mapped tasks only.
 *
 * This module does NOT modify the overlay (it works fine).
 * It ONLY injects reminders into the LLM context when todos remain.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * A task that is tracked by the sync layer
 */
interface TrackedTask {
    id: string;
    title: string;
    status: string;
}
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
    /** Enable verbose debug logging */
    verbose?: boolean;
}
/**
 * Create a todo reminder instance
 */
export declare function createTodoReminder(pi: ExtensionAPI, config?: TodoReminderConfig): TodoReminder;
/**
 * TodoReminder class — injects reminders when todos remain.
 *
 * Key design decisions:
 * 1. DISABLED by default (autoRemind: false) — Phase 1 containment
 * 2. Deduplication is persistent via file-based hash (survives process restart)
 * 3. Narrow trigger: only agent_end, never generic bash
 * 4. deliverAs: "steer" avoids transcript growth
 */
export declare class TodoReminder {
    private pi;
    private config;
    private lastReminderAt;
    private state;
    constructor(pi: ExtensionAPI, config: Required<TodoReminderConfig>);
    /**
     * Start the reminder system
     */
    start(): void;
    /**
     * Check if reminders should be sent and send them
     */
    private checkAndRemind;
    /**
     * Get remaining (pending/in-progress) todos from bd.
     *
     * NOTE: This returns ALL open bd issues, not just mapped ones.
     * When the mapping registry is integrated, this should be scoped.
     */
    private getTrackedTodos;
    /**
     * Format the reminder message
     */
    private formatReminder;
    /**
     * Send the reminder to the LLM.
     *
     * FIX: Re-check state before send to prevent stale reminders.
     * If a task was closed after we prepared the reminder, skip delivery.
     */
    private sendReminder;
    /**
     * Manually trigger a reminder (for slash command)
     */
    triggerNow(): Promise<void>;
    /**
     * Get current remaining count
     */
    getRemainingCount(): number;
    /**
     * Clear the persistent dedupe state (for testing or manual reset)
     */
    clearState(): void;
}
/**
 * Create a reminder with custom todos source (for tighter scoping)
 * @param pi - Extension API
 * @param getRemaining - Function that returns remaining todos
 * @param config - Reminder config
 */
export declare function createCustomReminder(pi: ExtensionAPI, getRemaining: () => TrackedTask[], config?: TodoReminderConfig): CustomTodoReminder;
/**
 * Custom reminder with injectable todos source.
 * Use this to scope reminders to only mapped/created tasks.
 */
declare class CustomTodoReminder {
    private pi;
    private getRemaining;
    private config;
    private lastReminderAt;
    private state;
    constructor(pi: ExtensionAPI, getRemaining: () => TrackedTask[], config: TodoReminderConfig);
    start(): void;
    private checkAndRemind;
    private formatReminder;
    private sendReminder;
    triggerNow(): Promise<void>;
    getRemainingCount(): number;
    /**
     * Clear the persistent dedupe state
     */
    clearState(): void;
}
export {};
//# sourceMappingURL=todo-reminder.d.ts.map