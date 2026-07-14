/**
 * A2A Adapter — A2A Client (RFC-0069)
 *
 * Discover and delegate to remote A2A agents.
 */
import { A2ATransport } from "./transport.js";
import { wellKnownAgentUrl } from "./protocol.js";
export { A2ATransport } from "./transport.js";
/**
 * A2A Client — discover and delegate to remote agents
 */
export class A2AClient {
    transport;
    constructor(baseUrl, config) {
        this.transport = new A2ATransport(baseUrl, config);
    }
    /**
     * Discover agent via URL
     */
    async discoverAgent(url) {
        const agentUrl = url ?? wellKnownAgentUrl(this.transport["baseUrl"]);
        const transport = new A2ATransport(agentUrl);
        return transport.getAgentCard();
    }
    /**
     * List agents (if target supports agent listing)
     */
    async listAgents(_filter) {
        return [];
    }
    /**
     * Find agents by skill/capability
     * Note: This requires a registry or directory service
     */
    async findAgents(_criteria) {
        return [];
    }
    /**
     * Send task to agent
     */
    async sendTask(message, options = {}) {
        const taskMessage = {
            role: "user",
            content: message,
        };
        return this.transport.sendTask({ ...options, message: taskMessage });
    }
    /**
     * Send task with streaming updates
     */
    async sendTaskSubscribe(message, options = {}) {
        const taskMessage = { role: "user", content: message };
        return this.transport.sendTaskSubscribe({
            ...options,
            message: taskMessage,
        });
    }
    /**
     * Get task result
     */
    async getTaskResult(taskId) {
        return this.transport.getTask(taskId);
    }
    /**
     * Cancel task
     */
    async cancelTask(taskId) {
        await this.transport.cancelTask(taskId);
    }
    /**
     * Subscribe to task updates via SSE
     */
    async *subscribeToTask(taskId) {
        yield* this.transport.streamTaskUpdates(taskId);
    }
}
//# sourceMappingURL=client.js.map