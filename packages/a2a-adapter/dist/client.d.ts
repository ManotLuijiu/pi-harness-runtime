/**
 * A2A Adapter — A2A Client (RFC-0069)
 *
 * Discover and delegate to remote A2A agents.
 */
import type { AgentCard, A2AClientConfig, TaskHandle, Task } from "./types.js";
export { A2ATransport } from "./transport.js";
export interface AgentSearchCriteria {
    skill?: string;
    capability?: string;
}
/**
 * A2A Client — discover and delegate to remote agents
 */
export declare class A2AClient {
    private transport;
    constructor(baseUrl: string, config?: A2AClientConfig);
    /**
     * Discover agent via URL
     */
    discoverAgent(url?: string): Promise<AgentCard>;
    /**
     * List agents (if target supports agent listing)
     */
    listAgents(_filter?: Record<string, string>): Promise<AgentCard[]>;
    /**
     * Find agents by skill/capability
     * Note: This requires a registry or directory service
     */
    findAgents(_criteria: AgentSearchCriteria): Promise<AgentCard[]>;
    /**
     * Send task to agent
     */
    sendTask(message: string, options?: {
        taskId?: string;
        sessionId?: string;
    }): Promise<TaskHandle>;
    /**
     * Send task with streaming updates
     */
    sendTaskSubscribe(message: string, options?: {
        taskId?: string;
        sessionId?: string;
    }): Promise<TaskHandle>;
    /**
     * Get task result
     */
    getTaskResult(taskId: string): Promise<Task>;
    /**
     * Cancel task
     */
    cancelTask(taskId: string): Promise<void>;
    /**
     * Subscribe to task updates via SSE
     */
    subscribeToTask(taskId: string): AsyncGenerator<unknown>;
}
//# sourceMappingURL=client.d.ts.map