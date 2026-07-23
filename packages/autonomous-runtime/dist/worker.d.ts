/**
 * Worker Stub — RFC-0101 §4
 *
 * A worker is a pi session that owns tasks from the inbox.
 * This is the lightweight worker-side of the lease protocol.
 *
 * The worker picks up work via the inbox's `claim()` method
 * and reports results via `complete()`.
 */
import type { TaskResult, WorkerStatus } from "./types.js";
import type { TaskInbox } from "./inbox.js";
import type { TaskLease } from "./lease.js";
export interface WorkerConfig {
    inbox: TaskInbox;
    workerId: string;
    heartbeatIntervalMs?: number;
    onError?: (taskId: string, error: unknown) => void;
}
export interface WorkerEvents {
    onLease: (lease: TaskLease) => void;
    onLeaseExpired: (taskId: string) => void;
    onComplete: (taskId: string, result: TaskResult) => void;
    onError: (taskId: string, error: unknown) => void;
}
/**
 * Worker — picks up tasks from the inbox and processes them.
 *
 * Lifecycle:
 * 1. Construct with inbox + workerId
 * 2. `start()` — begins polling/claiming tasks
 * 3. `stop()` — stops claiming, expires held leases
 *
 * The worker does NOT run tasks itself — it delegates to the harness
 * loop runtime. It just manages the lease lifecycle.
 */
export declare class Worker {
    private readonly config;
    private readonly events;
    private running;
    private heartbeatTimer;
    constructor(config: WorkerConfig);
    on<K extends keyof WorkerEvents>(event: K, handler: WorkerEvents[K]): void;
    /**
     * Start the worker — begins polling for available tasks.
     */
    start(): Promise<void>;
    /**
     * Stop the worker — stops polling and expires any held leases.
     */
    stop(): Promise<void>;
    /**
     * Status of this worker.
     */
    status(): WorkerStatus;
    private _poll;
    private _processTask;
    /**
     * Run a single task. Stub — replaces with actual harness loop integration.
     */
    private _runTask;
    private _heartbeat;
}
//# sourceMappingURL=worker.d.ts.map