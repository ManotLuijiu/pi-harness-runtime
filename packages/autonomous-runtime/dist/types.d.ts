/** A named capability that the privilege broker may grant. */
export type CapabilityName = "files.read" | "files.write" | "files.exec" | "git.commit" | "git.push" | "git.pull" | "system.restart" | "system.restart-service" | "system.logs" | "bench.migrate" | "bench.build" | "bench.restart" | "okf.promote-pattern" | "okf.promote-lesson" | "notify.send" | "llm.invoke";
/** What approval class a capability requires. */
export type ApprovalClass = "automatic_read_only" | "automatic_reversible" | "human_approval_required" | "forbidden";
export type TaskStatus = "queued" | "claimed" | "running" | "waiting_approval" | "waiting_quota" | "retrying" | "completed" | "failed" | "dead_letter";
/** Immutable log of what happened to a task. */
export type TaskEvent = {
    ts: string;
    kind: "claimed" | "started" | "checkpointed" | "progress" | "blocked" | "approval_requested" | "approved" | "denied" | "failed" | "completed" | "recovered" | "dead_lettered" | "transitioned";
    payload?: Record<string, unknown>;
};
/** The primary durable record for a task. */
export interface TaskRecord {
    id: string;
    objective: string;
    acceptanceCriteria: string[];
    source: {
        kind: "chat";
        userId: string;
    } | {
        kind: "schedule";
        scheduleId: string;
    } | {
        kind: "webhook";
        url: string;
    } | {
        kind: "subagent";
        parentTaskId: string;
    } | {
        kind: "manual";
        createdBy: string;
    };
    priority: 0 | 1 | 2 | 3 | 4;
    capabilities: CapabilityName[];
    approvalClass: ApprovalClass;
    status: TaskStatus;
    attempts: number;
    maxAttempts: number;
    context?: ExecutionContext;
    createdAt: string;
    updatedAt: string;
    leaseId?: string;
    result?: TaskResult;
    failureReason?: string;
    history: TaskEvent[];
}
/** A lease held by a worker on a specific task. */
export interface TaskLease {
    taskId: string;
    workerId: string;
    acquiredAt: string;
    expiresAt: string;
    heartbeatAt: string;
    attempt: number;
}
/** Heartbeat emitted by a worker every 5 s to worker-registry.json. */
export interface WorkerHeartbeat {
    workerId: string;
    startedAt: string;
    lastBeatAt: string;
    capacity: number;
    inflightTaskIds: string[];
}
/** A resolved grant from the privilege broker. */
export interface CapabilityGrant {
    name: CapabilityName;
    argv: string[];
    envWhitelist?: string[];
    user: string;
    cwd?: string;
    timeoutMs: number;
}
/** An in-flight human approval request. */
export interface ApprovalRequest {
    id: string;
    taskId: string;
    capability: CapabilityName;
    rationale: string;
    signedBy?: {
        keyFingerprint: string;
        ts: string;
    };
    decision?: "approved" | "denied";
    decidedAt?: string;
    expiresAt: string;
}
/** A scheduled recurring task. */
export interface ScheduledTask {
    id: string;
    taskTemplate: Omit<TaskRecord, "id" | "status" | "attempts" | "createdAt" | "updatedAt" | "history">;
    schedule: ScheduleSpec;
    enabled: boolean;
    lastFiredAt?: string;
    nextFireAt?: string;
}
export type ScheduleSpec = {
    kind: "cron";
    expression: string;
} | {
    kind: "interval";
    intervalMs: number;
} | {
    kind: "once";
    at: string;
};
export type RuntimeNotificationEvent = "task.claimed" | "task.started" | "task.completed" | "task.failed" | "task.waiting_approval" | "task.dead_lettered" | "lease.expired" | "worker.started" | "worker.stopped" | "approval.approved" | "approval.denied" | "approval.expired";
export interface NotificationEvent {
    kind: RuntimeNotificationEvent;
    ts: string;
    taskId?: string;
    workerId?: string;
    payload: Record<string, unknown>;
}
export interface Checkpoint {
    taskId: string;
    attempt: number;
    state: Record<string, unknown>;
    savedAt: string;
}
/** The context given to the loop runtime when executing a task. */
export interface ExecutionContext {
    taskId: string;
    workerId: string;
    inputs: Record<string, unknown>;
    capabilitiesGranted: CapabilityName[];
    approvalClass: ApprovalClass;
    lease: TaskLease;
    checkpoint?: Checkpoint;
    okfBundles: string[];
}
export interface TaskResult {
    taskId: string;
    status: "completed" | "failed" | "dead_letter";
    deliverables?: {
        path: string;
        mime: string;
    }[];
    acceptanceCriteriaMet: {
        criterion: string;
        passed: boolean;
        evidence?: string;
    }[];
    durationMs: number;
    modelUsage?: {
        inputTokens: number;
        outputTokens: number;
        provider: string;
    };
}
/** Returns the standard storage root for the runtime. */
export declare function getRuntimeRoot(): string;
/** Returns the inbox directory path. */
export declare function getInboxDir(): string;
/** Returns the claimed leases directory path. */
export declare function getLeasesDir(): string;
/** Returns the task JSONL file path. */
export declare function getTasksPath(): string;
/** Returns the worker registry path. */
export declare function getWorkerRegistryPath(): string;
//# sourceMappingURL=types.d.ts.map