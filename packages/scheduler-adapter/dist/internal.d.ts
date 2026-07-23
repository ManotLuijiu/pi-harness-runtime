/**
 * Scheduler Adapter — Internal (In-Process) Backend
 * RFC-0101 §6
 *
 * Uses in-process setTimeout / setInterval for scheduling.
 * Useful for testing, local development, and environments where
 * systemd/cron are not available.
 */
import type { SchedulerAdapter, ScheduledTask } from "./interface.js";
export declare class InternalAdapter implements SchedulerAdapter {
    readonly name: "internal";
    private tasks;
    private handlers;
    install(): Promise<void>;
    healthCheck(): Promise<{
        healthy: boolean;
        error?: string;
    }>;
    /**
     * Register a task handler before scheduling.
     * The adapter calls `handler(task)` when the task fires.
     */
    setHandler(handler: (task: ScheduledTask) => unknown): void;
    schedule(task: ScheduledTask): Promise<void>;
    unschedule(taskId: string): Promise<void>;
    listScheduled(): Promise<ScheduledTask[]>;
    /** Fire a task immediately (useful for testing). */
    fireNow(taskId: string): void;
}
//# sourceMappingURL=internal.d.ts.map