/**
 * Scheduler Adapter — Common Interface
 * RFC-0101 §6
 *
 * All scheduler adapters implement this interface.
 * The runtime selects an adapter at install time and uses it for all scheduled tasks.
 */
export type ScheduledTask = {
    id: string;
    taskTemplate: Record<string, unknown>;
    schedule: {
        kind: "cron";
        expression: string;
    } | {
        kind: "interval";
        intervalMs: number;
    } | {
        kind: "once";
        at: string;
    };
    enabled: boolean;
    lastFiredAt?: string;
    nextFireAt?: string;
};
/**
 * Supported scheduler adapter backends.
 * Set at install time; can be changed via config.
 */
export type SchedulerAdapterKind = "systemd" | "cron" | "launchd" | "internal";
export interface SchedulerAdapter {
    /** Human-readable name. */
    readonly name: SchedulerAdapterKind;
    /**
     * Install the scheduler adapter.
     * Idempotent — re-running does not duplicate units.
     * @throws if installation fails (e.g. no systemd on this system)
     */
    install(): Promise<void>;
    /**
     * Schedule a task. Installs the timer/unit if not yet installed.
     * @param task The scheduled task to materialise
     */
    schedule(task: ScheduledTask): Promise<void>;
    /**
     * Remove a scheduled task.
     * @param taskId The id of the task to unschedule
     */
    unschedule(taskId: string): Promise<void>;
    /**
     * List all scheduled tasks currently installed by this adapter.
     */
    listScheduled(): Promise<ScheduledTask[]>;
    /**
     * Check if the adapter is healthy (e.g. systemd is running).
     */
    healthCheck(): Promise<{
        healthy: boolean;
        error?: string;
    }>;
}
//# sourceMappingURL=interface.d.ts.map