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
import type { JobStateMachine } from "../../harness/job-state-machine.js";
import type { TaskGraphManager } from "../../../harness/task-graph.js";
import type { CheckpointManager } from "../../harness/job-state-machine.js";
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
    registerJob(jobId: string, machine: JobStateMachine): void;
    /**
     * Register a task graph
     */
    registerTaskGraph(jobId: string, graph: TaskGraphManager): void;
    /**
     * Register a checkpoint manager
     */
    registerCheckpointManager(jobId: string, manager: CheckpointManager): void;
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