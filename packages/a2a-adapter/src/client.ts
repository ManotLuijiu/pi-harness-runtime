/**
 * A2A Adapter — A2A Client (RFC-0069)
 *
 * Discover and delegate to remote A2A agents.
 */

import { A2ATransport } from "./transport.js";
import { wellKnownAgentUrl } from "./protocol.js";
import type {
	AgentCard,
	A2AClientConfig,
	TaskHandle,
	TaskMessage,
	Task,
	Skill,
} from "./types.js";

export { A2ATransport } from "./transport.js";

export interface AgentSearchCriteria {
	skill?: string;
	capability?: string;
}

/**
 * A2A Client — discover and delegate to remote agents
 */
export class A2AClient {
	private transport: A2ATransport;

	constructor(baseUrl: string, config?: A2AClientConfig) {
		this.transport = new A2ATransport(baseUrl, config);
	}

	/**
	 * Discover agent via URL
	 */
	async discoverAgent(url?: string): Promise<AgentCard> {
		const agentUrl = url ?? wellKnownAgentUrl(this.transport["baseUrl"]);
		const transport = new A2ATransport(agentUrl);
		return transport.getAgentCard();
	}

	/**
	 * List agents (if target supports agent listing)
	 */
	async listAgents(_filter?: Record<string, string>): Promise<AgentCard[]> {
		return [];
	}

	/**
	 * Find agents by skill/capability
	 * Note: This requires a registry or directory service
	 */
	async findAgents(_criteria: AgentSearchCriteria): Promise<AgentCard[]> {
		return [];
	}

	/**
	 * Send task to agent
	 */
	async sendTask(
		message: string,
		options: { taskId?: string; sessionId?: string } = {},
	): Promise<TaskHandle> {
		const taskMessage: TaskMessage = {
			role: "user",
			content: message,
		};
		return this.transport.sendTask({ ...options, message: taskMessage });
	}

	/**
	 * Send task with streaming updates
	 */
	async sendTaskSubscribe(
		message: string,
		options: { taskId?: string; sessionId?: string } = {},
	): Promise<TaskHandle> {
		const taskMessage: TaskMessage = { role: "user", content: message };
		return this.transport.sendTaskSubscribe({
			...options,
			message: taskMessage,
		});
	}

	/**
	 * Get task result
	 */
	async getTaskResult(taskId: string): Promise<Task> {
		return this.transport.getTask(taskId) as Promise<Task>;
	}

	/**
	 * Cancel task
	 */
	async cancelTask(taskId: string): Promise<void> {
		await this.transport.cancelTask(taskId);
	}

	/**
	 * Subscribe to task updates via SSE
	 */
	async *subscribeToTask(taskId: string): AsyncGenerator<unknown> {
		yield* this.transport.streamTaskUpdates(taskId);
	}
}
