/**
 * Harness Runtime — Core Module Index
 *
 * Re-exports all harness components for easy importing.
 */

// Re-export types from the types package
export type {
	JobStatus,
	TaskStatus,
	RuntimeCheckpoint,
	RuntimeTask,
	RuntimeEvent,
	TaskGraph,
	TaskNode,
	RepairTask,
	FailureType,
	AttemptedFix,
	RetryPolicy,
	QuotaSignal,
	QuotaState,
	ProviderConfig,
	ProviderCapability,
	ProviderRequest,
	ProviderResponse,
	E2EScenario,
	E2EStep,
	E2EResult,
	E2EReport,
} from "../packages/types/src/runtime-types.js";

// State Machine
export { JobStateMachine } from "./job-state-machine.js";
export type {
	StateTransition,
	TransitionResult,
} from "./job-state-machine.js";
export type { CheckpointManager } from "./job-state-machine.js";

// Task Graph
export { TaskGraphManager } from "./task-graph.js";
export type { TaskGraphOptions } from "./task-graph.js";

// Loop Runtime
export { LoopRuntime } from "./loop-runtime.js";
export type { LoopResult } from "./loop-runtime.js";

// Repair Engine
export { RepairEngine } from "./repair-engine.js";
export type { RepairResult } from "./repair-engine.js";

// Master Planner
export { MasterPlanner } from "./master-planner.js";
export type { PlanResult } from "./master-planner.js";

// Context Window Manager
export { ContextWindowManager } from "./context-window-manager.js";

// Blackboard
export { createBlackboard, SharedBlackboard } from "./blackboard.js";

// Agent Handoff
export { AgentHandoffProtocol } from "./agent-handoff.js";

// Auto Compact (RFC-0019)
export { AutoCompactEngine } from "./auto-compact.js";
export type {
	CompactionEvent,
	CompactionConfig,
	ContinuePrompt,
} from "./auto-compact.js";

// Output Limit Handler (RFC-0020)
export { OutputLimitHandler } from "./output-limit-handler.js";
export type {
	OutputLimitConfig,
	OutputLimitEvent,
	ExpectedOutput,
} from "./output-limit-handler.js";

// Partial Recovery (RFC-0021)
export { PartialRecovery } from "./partial-recovery.js";
export type {
	PartialResponse,
	RecoveryStatus,
	MergeOptions,
} from "./partial-recovery.js";

// Notification Events (RFC-0022)
export {
	HarnessNotificationEvents,
	createNotificationConfigFromEnv,
} from "./notification-events.js";

// E2E Testing
export { E2ETestEngine } from "./e2e/test-engine.js";
export { PlaywrightE2ERunner } from "./e2e/playwright-runner.js";
export { MiniMaxQuotaScraper } from "./e2e/playwright-runner.js";
export type {
	E2ERunner,
	PlaywrightRunnerConfig,
} from "./e2e/playwright-runner.js";

// Project Detector
export { ProjectDetector } from "./project-detector/detector.js";
