/**
 * A2A Adapter — A2A Agent (RFC-0069)
 *
 * Expose this harness agent as an A2A-compatible agent.
 */
import type { AgentCard, A2AAgentConfig, Task, TaskMessage } from "./types.js";
/**
 * Create an AgentCard for this harness agent
 */
export declare function createAgentCard(config: A2AAgentConfig): AgentCard;
/**
 * Route incoming A2A task to harness skill-registry
 */
export declare function routeTask(message: TaskMessage): Promise<Task>;
/**
 * Get task by ID
 */
export declare function getTask(taskId: string): Task | null;
/**
 * Cancel a task
 */
export declare function cancelTask(taskId: string): boolean;
/**
 * Generate task status update SSE
 */
export declare function taskStatusUpdateSSE(taskId: string): string;
//# sourceMappingURL=agent.d.ts.map