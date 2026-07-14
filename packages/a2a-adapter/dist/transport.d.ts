/**
 * A2A Adapter — HTTP Transport (RFC-0069)
 */
import type { AgentCard, A2AClientConfig, TaskHandle } from "./types.js";
/**
 * HTTP client for A2A protocol
 */
export declare class A2ATransport {
    private baseUrl;
    private config;
    constructor(baseUrl: string, config?: A2AClientConfig);
    private request;
    /**
     * Fetch agent card from well-known endpoint
     */
    getAgentCard(): Promise<AgentCard>;
    /**
     * Send a task message to an agent
     */
    sendTask(params: {
        taskId?: string;
        sessionId?: string;
        message: {
            role: string;
            content: string;
        };
    }): Promise<TaskHandle>;
    /**
     * Send task with streaming subscription
     */
    sendTaskSubscribe(params: {
        taskId?: string;
        sessionId?: string;
        message: {
            role: string;
            content: string;
        };
    }): Promise<TaskHandle>;
    /**
     * Get task status
     */
    getTask(taskId: string): Promise<unknown>;
    /**
     * Cancel a task
     */
    cancelTask(taskId: string): Promise<{
        taskId: string;
        status: string;
    }>;
    /**
     * SSE stream for task updates
     */
    streamTaskUpdates(taskId: string): AsyncGenerator<unknown>;
}
//# sourceMappingURL=transport.d.ts.map