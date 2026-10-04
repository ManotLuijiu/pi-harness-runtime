/**
 * DeepAgents Adapter — RFC-0029
 *
 * Implements the AgentWorker interface for DeepAgents.
 * DeepAgents is an optional Agent Worker; Runtime remains the orchestrator.
 *
 * @module deepagents-adapter
 */
import type { AgentWorker, AgentWorkerConfig, AgentStatus, TaskRequest, TaskResult, HealthStatus, AgentWorkerEvents } from "../../types/src/agent-worker-types.js";
/**
 * DeepAgents Adapter
 *
 * Connects the harness runtime to a DeepAgents worker.
 * Runtime orchestrates; DeepAgents executes tasks.
 */
export declare class DeepAgentsAdapter implements AgentWorker {
    readonly id: string;
    readonly provider: "deepagents";
    private config;
    private _status;
    private abortController;
    private currentTaskId;
    constructor(id: string);
    /**
     * Initialize the DeepAgents adapter
     */
    initialize(config: AgentWorkerConfig): Promise<void>;
    /**
     * Execute a task using DeepAgents
     */
    execute(request: TaskRequest, events?: Partial<AgentWorkerEvents>): Promise<TaskResult>;
    /**
     * Check health of DeepAgents connection
     */
    health(): Promise<HealthStatus>;
    /**
     * Get current status
     */
    status(): AgentStatus;
    /**
     * Pause the agent
     */
    pause(): Promise<void>;
    /**
     * Resume the agent
     */
    resume(): Promise<void>;
    /**
     * Stop the agent
     */
    stop(): Promise<void>;
    /**
     * Check if a model is supported
     */
    supportsModel(model: string): boolean;
    /**
     * Get supported models
     */
    getSupportedModels(): string[];
    /**
     * Build a DeepAgents API request from a task request
     */
    private buildDeepAgentsRequest;
    /**
     * Call the DeepAgents API
     */
    private callDeepAgents;
    /**
     * Parse DeepAgents response into TaskResult
     */
    private parseDeepAgentsResponse;
}
/**
 * Factory function to create a DeepAgentsAdapter
 * Matches AgentWorkerFactory signature from RFC-0030
 */
export declare function createDeepAgentsAdapter(config: AgentWorkerConfig): AgentWorker;
//# sourceMappingURL=deepagents-adapter.d.ts.map