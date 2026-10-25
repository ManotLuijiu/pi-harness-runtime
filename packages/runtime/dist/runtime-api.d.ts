/**
 * Runtime API — RFC-0027
 *
 * HTTP/RPC API for runtime control, job management, and status queries.
 *
 * Endpoints:
 * - GET  /health              - Health check
 * - GET  /jobs                - List jobs
 * - POST /jobs                - Create job
 * - GET  /jobs/:id            - Get job status
 * - POST /jobs/:id/start      - Start job
 * - POST /jobs/:id/pause      - Pause job
 * - POST /jobs/:id/resume     - Resume job
 * - POST /jobs/:id/cancel     - Cancel job
 * - GET  /jobs/:id/tasks       - List tasks
 * - GET  /jobs/:id/tasks/:tid - Get task status
 * - POST /jobs/:id/tasks/:tid - Update task
 * - GET  /quota               - Get quota status
 * - GET  /config              - Get runtime config
 * - PUT  /config              - Update runtime config
 * - WS   /ws                  - WebSocket for real-time events
 */
import { EventEmitter } from "node:events";
import type { JobStatus, RuntimeCheckpoint, RuntimeEvent, RuntimeTask } from "../../types/dist/runtime-types.js";
/**
 * The outcome of a job transition, as reported by the registered machine.
 */
export interface JobTransitionResult {
    success: boolean;
    checkpoint?: RuntimeCheckpoint;
    error?: string;
}
/**
 * The job state machine the harness registers.
 *
 * The runtime API does not implement a job: it stores the machine the
 * harness already runs and reports on it. The package therefore describes
 * the shape it uses instead of importing the harness - the harness is the
 * app root, a package may not reach into it, and the import also dragged
 * the whole harness program into this package's compilation.
 */
export interface JobStateMachineLike {
    getStatusSummary(): {
        status: JobStatus;
        isTerminal: boolean;
        canResume: boolean;
    } | null;
    getCheckpoint(): RuntimeCheckpoint | null | Promise<RuntimeCheckpoint | null>;
    resumeJob(jobId: string): Promise<JobTransitionResult>;
    transition(to: JobStatus, data?: Partial<RuntimeCheckpoint>): Promise<JobTransitionResult>;
}
/**
 * The task graph the harness registers.
 */
export interface TaskGraphLike {
    getAllTasks(): RuntimeTask[];
}
/**
 * The checkpoint manager the harness registers.
 */
export interface CheckpointManagerLike {
    save(checkpoint: RuntimeCheckpoint): Promise<void>;
    load(jobId: string): Promise<RuntimeCheckpoint | null>;
    appendEvent(jobId: string, event: RuntimeEvent): Promise<void>;
}
export interface RuntimeApiConfig {
    /** Port to listen on (default: 3849) */
    port?: number;
    /** Host to bind to (default: localhost) */
    host?: string;
    /** API key for authentication (optional) */
    apiKey?: string;
    /** Enable CORS (default: false) */
    cors?: boolean;
    /** Allowed origins for CORS */
    corsOrigins?: string[];
    /** Enable WebSocket (default: true) */
    enableWebSocket?: boolean;
    /** Request timeout in ms (default: 30000) */
    requestTimeoutMs?: number;
}
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: string;
    requestId: string;
}
export interface JobSummary {
    jobId: string;
    requirement: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    progress: {
        total: number;
        done: number;
        running: number;
        failed: number;
    };
}
export interface TaskSummary {
    taskId: string;
    title: string;
    status: string;
    assignedAgent?: string;
    dependencies: string[];
    createdAt: string;
    updatedAt: string;
}
export interface RuntimeStatus {
    running: boolean;
    version: string;
    uptime: number;
    jobs: {
        total: number;
        active: number;
        paused: number;
        completed: number;
    };
}
export declare class RuntimeApi extends EventEmitter {
    private readonly config;
    private server;
    private wsServer;
    private wsClients;
    private isRunning;
    private startTime;
    private jobMachines;
    private taskGraphs;
    private checkpoints;
    private requestCounter;
    constructor(config?: RuntimeApiConfig);
    /**
     * The port the API listens on.
     *
     * The operating system picks the port when the API was started on port
     * 0, so the running port is not always the configured one.
     */
    getPort(): number | null;
    /**
     * Start the Runtime API server
     */
    start(): Promise<void>;
    /**
     * Stop the Runtime API server
     */
    stop(): Promise<void>;
    /**
     * Register a job machine
     */
    registerJob(jobId: string, machine: JobStateMachineLike): void;
    /**
     * Register a task graph
     */
    registerTaskGraph(jobId: string, graph: TaskGraphLike): void;
    /**
     * Register a checkpoint manager
     */
    registerCheckpointManager(jobId: string, manager: CheckpointManagerLike): void;
    /**
     * Emit an event to all WebSocket clients
     */
    broadcast(event: string, data: unknown): void;
    private startWebSocket;
    private authenticate;
    private setCorsHeaders;
    private handleRequest;
    private handleHealth;
    private handleStatus;
    private handleListJobs;
    private handleCreateJob;
    private handleJob;
    /**
     * Move a job to a new state.
     *
     * The machine keeps the active checkpoint in memory, so it has to be
     * activated for the job before it can transition. The transition itself
     * validates the move against the state machine's rules and reports the
     * outcome, so a refused move never becomes a false success.
     */
    private moveJob;
    private handleGetQuota;
    private handleGetConfig;
    private sendJson;
    private generateRequestId;
}
/**
 * Create RuntimeApi with default config for harness runtime
 */
export declare function createHarnessRuntimeApi(): RuntimeApi;
//# sourceMappingURL=runtime-api.d.ts.map