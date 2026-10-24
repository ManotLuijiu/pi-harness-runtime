export interface ScheduledJob {
    jobId: string;
    status: "scheduled" | "cancelled";
    reason: string;
    resumeAt: string;
}
export declare class JsonRuntimeScheduler {
    private readonly rootDir;
    constructor(rootDir: string);
    private schedulePath;
    readAll(): Promise<ScheduledJob[]>;
    writeAll(jobs: ScheduledJob[]): Promise<void>;
    scheduleResume(jobId: string, resumeAt: string, reason: string): Promise<void>;
    dueJobs(now?: Date): Promise<string[]>;
    cancel(jobId: string): Promise<void>;
}
//# sourceMappingURL=scheduler.d.ts.map