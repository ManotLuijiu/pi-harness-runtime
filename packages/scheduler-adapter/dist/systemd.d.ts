/**
 * Scheduler Adapter — systemd Backend
 * RFC-0101 §6
 *
 * Uses systemd user timers as the scheduling backend.
 * Each scheduled task becomes a .timer + .service unit pair.
 * Works on any Linux system with systemd (no root required for user units).
 */
import type { SchedulerAdapter, ScheduledTask } from "./interface.js";
/**
 * Install systemd user units (runs `systemctl --user`).
 * Must call this once before scheduling.
 */
export declare class SystemdAdapter implements SchedulerAdapter {
    readonly name: "systemd";
    /** Per-task unit files live in ~/.config/systemd/user/ */
    private readonly unitDir;
    private installed;
    constructor(unitDir?: string);
    install(): Promise<void>;
    schedule(task: ScheduledTask): Promise<void>;
    unschedule(taskId: string): Promise<void>;
    listScheduled(): Promise<ScheduledTask[]>;
    /** Convert a schedule to a systemd.timer OnCalendar or OnUnitActiveSec line. */
    private _toTimerLine;
    healthCheck(): Promise<{
        healthy: boolean;
        error?: string;
    }>;
}
//# sourceMappingURL=systemd.d.ts.map