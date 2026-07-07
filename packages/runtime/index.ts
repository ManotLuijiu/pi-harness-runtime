/**
 * Runtime Package — RFC-0024, RFC-0025, RFC-0026, RFC-0027, RFC-0028
 *
 * Core runtime components for the pi-harness-runtime.
 */

// RFC-0024: Local Runtime Agent
export { LocalRuntimeAgent, createHarnessRuntimeAgent } from "./local-runtime-agent.js";
export type { LocalRuntimeAgentConfig, LocalRuntimeAgentEvents, QuotaSummary, AuthSession } from "./local-runtime-agent.js";

// RFC-0025: Command Executor
export { CommandExecutor, createHarnessExecutor } from "./command-executor.js";
export type {
	CommandResult,
	CommandOptions,
	CommandPolicy,
	CommandEvent,
	CommandExecutorEvents,
} from "./command-executor.js";

// RFC-0026: Workspace Manager
export { WorkspaceManager, createHarnessWorkspaceManager } from "./workspace-manager.js";
export type {
	Workspace,
	WorkspaceConfig,
	WorkspaceEvent,
} from "./workspace-manager.js";

// RFC-0027: Runtime API
export { RuntimeApi, createHarnessRuntimeApi } from "./runtime-api.js";
export type {
	RuntimeApiConfig,
	ApiResponse,
	JobSummary,
	TaskSummary,
	RuntimeStatus,
} from "./runtime-api.js";

// RFC-0028: Policy Engine
export { PolicyEngine, createHarnessPolicyEngine } from "./policy-engine.js";
export type {
	PolicyResult,
	PolicyContext,
	Policy,
	PolicyCondition,
	PolicyEffect,
	PolicyRule,
	RateLimit,
	AuditEntry,
} from "./policy-engine.js";
