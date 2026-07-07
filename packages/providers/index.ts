/**
 * Providers Package
 *
 * Provider adapters, agent workers, and usage fetchers.
 */

// Provider Adapters (RFC-0002)
export {
	AdapterRegistry,
	MiniMaxAdapter,
	OpenAIAdapter,
	ClaudeAdapter,
} from "./adapters.js";
export type {
	AdapterConfig,
	AdapterResult,
	ProviderAdapter,
	QuotaSignal,
} from "./adapters.js";

// Agent Workers (RFC-0029, RFC-0030)
import {
	DeepAgentsAdapter,
	createDeepAgentsAdapter,
} from "./deepagents-adapter.js";
import {
	AgentWorkerRegistry,
	type AgentWorker,
	type AgentWorkerConfig,
	type AgentStatus,
	type TaskRequest,
	type TaskResult,
	type TaskResultStatus,
	type HealthStatus,
	type AgentWorkerEvents,
	type TaskProgress,
	type DeepAgentsConfig,
	type DeepAgentsTaskRequest,
	type DeepAgentsResult,
	type AgentWorkerFactory,
} from "../../packages/types/src/agent-worker-types.js";

// Re-export for consumers
export { DeepAgentsAdapter, createDeepAgentsAdapter, AgentWorkerRegistry };
export type {
	AgentWorker,
	AgentWorkerConfig,
	AgentStatus,
	TaskRequest,
	TaskResult,
	TaskResultStatus,
	HealthStatus,
	AgentWorkerEvents,
	TaskProgress,
	DeepAgentsConfig,
	DeepAgentsTaskRequest,
	DeepAgentsResult,
	AgentWorkerFactory,
};

// OpenAI Usage (TUI Message Parsing)
export { OpenAIUsageProvider } from "./openai-usage.js";
export type {
	OpenAIUsageData,
	OpenAIUsageConfig,
} from "./openai-usage.js";

// GLM Usage (TUI Message Parsing)
export { GLMUsageProvider } from "./glm-usage.js";
export type {
	GLMUsageData,
	GLMUsageConfig,
} from "./glm-usage.js";

/**
 * Create a default agent worker registry with all built-in workers
 */
export function createDefaultAgentWorkerRegistry(): AgentWorkerRegistry {
	const registry = new AgentWorkerRegistry();

	// Register DeepAgents adapter
	registry.register("deepagents", createDeepAgentsAdapter);

	return registry;
}
