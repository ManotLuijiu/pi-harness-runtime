/**
 * A2A Adapter — Main Entry (RFC-0069)
 */
export { A2AClient, type AgentSearchCriteria } from "./client.js";
export { A2ATransport } from "./transport.js";
export { createAgentCard, routeTask, getTask, cancelTask, taskStatusUpdateSSE, } from "./agent.js";
export type { AgentCard, AgentCapabilities, Skill, Authentication, Task, TaskStatus, TaskStatusUpdateEvent, TaskMessage, Artifact, A2ARequest, A2AResponse, A2AClientConfig, TaskHandle, A2AAgentConfig, } from "./types.js";
export { A2A_PROTOCOL_VERSION, WELL_KNOWN_AGENT_PATH } from "./protocol.js";
//# sourceMappingURL=index.d.ts.map