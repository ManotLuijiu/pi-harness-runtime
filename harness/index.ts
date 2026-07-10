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
	ContextWindowUpdate,
	ContextWindowStats,
	ContextWindowConfig,
	CompactableMessage,
	CompactResult,
	CompactTriggerReason,
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

// Loop Runtime
export { LoopRuntime } from "./loop-runtime.js";
export type { LoopResult, LoopCallbacks } from "./loop-runtime.js";

// Repair Engine
export { RepairEngine } from "./repair-engine.js";
export type { RepairResult } from "./repair-engine.js";

// Master Planner
export { MasterPlanner } from "./master-planner.js";
export type { PlanResult } from "./master-planner.js";

// Context Window Manager (RFC-0010 — enhanced with thresholds)
export {
	ContextWindowManager,
	microcompactToolResults,
	parseTokenGapFromError,
	AUTOCOMPACT_BUFFER_TOKENS,
	WARNING_THRESHOLD_BUFFER_TOKENS,
	BLOCKING_THRESHOLD_BUFFER_TOKENS,
	MAX_CONSECUTIVE_COMPACT_FAILURES,
} from "./context-window-manager.js";
export type {
	CompactThresholds,
	TokenEstimate,
} from "./context-window-manager.js";

// Forked Summarizer (RFC-0028 Phase 2 — LLM-based compaction)
export {
	ForkedSummarizer,
	createForkedSummarizer,
} from "./forked-summarizer.js";
export type {
	SummarizerConfig,
	SummarizerResult,
	InvokeOptions,
} from "./forked-summarizer.js";

// Continue Prompt Generator (RFC-0029 Phase 5 — auto-resume)
export {
	ContinuePromptGenerator,
	continuePromptGenerator,
} from "./continue-prompt.js";
export type {
	ContinueContext,
	MinimalContinueContext,
} from "./continue-prompt.js";

// BlackBoard
export { createBlackboard, SharedBlackboard } from "./blackboard.js";

// Agent Handoff
export { AgentHandoffProtocol } from "./agent-handoff.js";

// Auto Compact (RFC-0019)
export { AutoCompactEngine } from "./auto-compact.js";
export type { CompactionEvent, CompactionConfig } from "./auto-compact.js";

// Context Compact Orchestrator (RFC-0028)
export { CompactOrchestrator } from "./context-compact-orchestrator.js";
export type {
	CompactOrchestratorConfig,
	CompactOrchestratorCallbacks,
} from "./context-compact-orchestrator.js";

// Output Limit Handler (RFC-0020)
export { OutputLimitHandler } from "./output-limit-handler.js";
export type {
	OutputLimitConfig,
	OutputLimitEvent,
	ExpectedOutput,
} from "./output-limit-handler.js";

// Partial Recovery (RFC-0021)
export { PartialRecovery, createPartialRecovery } from "./partial-recovery.js";
export type {
	PartialResponse,
	RecoveryStatus,
	MergeOptions,
} from "./partial-recovery.js";

// Session Memory (RFC-0030)
export {
	SessionMemoryManager,
	createSessionMemoryManager,
} from "./session-memory.js";
export type {
	SessionMemory,
	Decision,
	FileReference,
	TestResult,
} from "./session-memory.js";

// Notification Events (RFC-0022)
export {
	HarnessNotificationEvents,
	createNotificationConfigFromEnv,
} from "./notification-events.js";

// E2E Testing
export { E2ETestEngine } from "./e2e/test-engine.js";
export { PlaywrightE2ERunner } from "./e2e/playwright-runner.js";
export type {
	E2ERunner,
	PlaywrightRunnerConfig,
} from "./e2e/playwright-runner.js";
export {
	MiniMaxQuotaScraper,
	MiniMaxQuotaManager,
} from "./e2e/minimax-quota-scraper.js";
export type {
	MiniMaxQuotaData,
	MiniMaxScraperConfig,
} from "./e2e/minimax-quota-scraper.js";
export {
	QuotaStatusManager,
	formatQuotaStatus,
	createQuotaStatusManagerFromEnv,
} from "./e2e/quota-status.js";
export type { QuotaStatus, QuotaDisplayConfig } from "./e2e/quota-status.js";

// Project Detector
export { ProjectDetector } from "./project-detector/detector.js";
