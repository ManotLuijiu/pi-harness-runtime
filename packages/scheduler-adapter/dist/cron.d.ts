import type { SchedulerAdapter } from "./interface.js";
import type { ScheduledTask } from "./interface.js";
export declare class CronAdapter implements SchedulerAdapter {
    readonly name: "cron";
    private readonly runtimeBin;
    constructor(options?: {
        runtimeBin?: string;
    });
    install(): Promise<void>;
    schedule(task: ScheduledTask): Promise<void>;
    unschedule(taskId: string): Promise<void>;
    listScheduled(): Promise<ScheduledTask[]>;
    healthCheck(): Promise<{
        healthy: boolean;
        error?: string;
    }>;
    private _getCrontab;
    private _setCrontab;
    private _toCronExpr;
}
//# sourceMappingURL=cron.d.ts.map