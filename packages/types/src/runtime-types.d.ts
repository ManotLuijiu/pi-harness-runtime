export type JobStatus = "created" | "planning" | "queued" | "running" | "testing" | "e2e_testing" | "reviewing" | "repairing" | "paused_quota" | "waiting_human" | "blocked" | "ready_for_client" | "archived" | "cancelled";
export type TaskStatus = "pending" | "ready" | "running" | "testing" | "reviewing" | "done" | "failed" | "blocked";
export type ProviderState = "available" | "limited" | "exhausted" | "disabled" | "unknown";
export interface RuntimeTask {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    assignedProvider?: string;
    worktreePath?: string;
    acceptanceCriteria?: string[];
    /** Task instructions (used by LoopRuntime for compactable message content) */
    instructions?: string;
    /** Tools available for this task */
    tools?: Array<{
        name: string;
        description?: string;
        input_schema?: Record<string, unknown>;
    }>;
}
export interface RuntimeCheckpoint {
    version: number;
    jobId: string;
    status: JobStatus;
    requirement: string;
    currentTaskId?: string;
    provider?: string;
    resumeAt?: string;
    lastError?: string;
    /** Provider that caused a quota pause (e.g. "minimax"). */
    quotaProvider?: string;
    /** Limit type that triggered the pause ("tokens" | "context_window" | etc.). */
    quotaLimitType?: string;
    createdAt: string;
    updatedAt: string;
    /** Loop iteration at checkpoint (used by LoopRuntime for resume) */
    iteration?: number;
    /** Task ID being executed at checkpoint */
    taskId?: string;
}
export interface RuntimeEvent {
    ts: string;
    jobId: string;
    type: string;
    message: string;
    data?: Record<string, unknown>;
}
export interface RuntimeContext {
    jobId: string;
    requirement: string;
    tasks: RuntimeTask[];
    providerStates: Record<string, ProviderState>;
}
export interface ProviderSelection {
    providerId: string;
    reason: string;
}
export interface TaskNode {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    dependencies: string[];
    dependents: string[];
    assignedAgent?: string;
    worktreePath?: string;
    acceptanceCriteria?: string[];
    retryCount?: number;
    maxRetries?: number;
    createdAt: string;
    updatedAt: string;
}
export interface TaskGraph {
    jobId: string;
    nodes: Record<string, TaskNode>;
    topologicalOrder: string[];
}
export interface BlackboardRecord {
    jobId: string;
    status: JobStatus;
    nextAction?: NextAction;
    tasks: TaskGraph;
    agentRegistry: AgentRegistry;
    reports: Record<string, AgentReport>;
    locks: Record<string, LockInfo>;
    updatedAt: string;
}
export interface NextAction {
    taskId?: string;
    agentId?: string;
    instruction: string;
    priority: "high" | "normal" | "low";
    createdAt: string;
    expiresAt?: string;
}
export interface AgentRegistry {
    agents: Record<string, AgentInfo>;
}
export interface AgentInfo {
    id: string;
    name: string;
    provider: string;
    model?: string;
    status: "idle" | "working" | "waiting" | "failed";
    currentTaskId?: string;
    startedAt?: string;
    lastHeartbeat?: string;
}
export interface AgentReport {
    agentId: string;
    taskId: string;
    status: "success" | "failure" | "partial";
    summary: string;
    filesChanged?: string[];
    testsRun?: number;
    testsPassed?: number;
    testsFailed?: number;
    createdAt: string;
}
export interface LockInfo {
    taskId: string;
    agentId: string;
    acquiredAt: string;
    expiresAt?: string;
}
export interface ContextWindowUpdate {
    provider: string;
    model: string;
    maxTokens: number;
    usedTokens: number;
}
export interface ContextWindowStats {
    provider: string;
    model: string;
    maxTokens: number;
    usedTokens: number;
    availableTokens: number;
    utilizationPct: number;
}
export interface ContextWindowConfig {
    warningThreshold: number;
    criticalThreshold: number;
    strategy: "truncate" | "summarize" | "split";
}
export interface QuotaSignal {
    provider: string;
    windowType: "5h" | "daily" | "weekly" | "monthly";
    usedPct: number;
    remainingPct: number;
    resetsAt?: string;
    exhausted: boolean;
    source: "api_response" | "provider_status" | "playwright" | "local_estimate" | "tui_message";
    capturedAt: string;
    retryAfterMs?: number;
}
export interface QuotaState {
    provider: string;
    available: boolean;
    limited: boolean;
    exhausted: boolean;
    signals: QuotaSignal[];
    nextAvailableAt?: string;
}
export interface ProviderConfig {
    id: string;
    name: string;
    apiKey?: string;
    baseUrl?: string;
    models: string[];
    capabilities: ProviderCapability[];
    rateLimits: RateLimitConfig;
}
export type ProviderCapability = "code" | "review" | "plan" | "test" | "e2e" | "refactor" | "analysis" | "debug";
export interface RateLimitConfig {
    requestsPerMinute?: number;
    tokensPerMinute?: number;
    tokensPerDay?: number;
    concurrentRequests?: number;
}
export interface ProviderResponse {
    content: string;
    usage?: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheWrite?: number;
        cost?: number;
    };
    model?: string;
    finishReason?: "stop" | "length" | "content_filter" | "error";
    error?: string;
}
export interface ProviderRequest {
    model: string;
    messages: ProviderMessage[];
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
}
export interface ProviderMessage {
    role: "system" | "user" | "assistant";
    content: string;
}
export interface HandoffContext {
    jobId: string;
    taskId: string;
    fromAgent: string;
    toAgent: string;
    sharedFiles: string[];
    taskHistory: HandoffEvent[];
    summary: string;
}
export interface HandoffEvent {
    ts: string;
    agentId: string;
    action: string;
    result?: string;
}
export type ProjectType = "frappe_erpnext" | "frappe_spa" | "nextjs" | "react_vite" | "django" | "laravel" | "generic_web" | "unknown";
export interface ProjectDetection {
    projectType: ProjectType;
    confidence: number;
    signals: string[];
    recommendedSeedStrategy: SeedStrategy;
    recommendedE2EStrategy: E2EStrategy;
    framework?: string;
    version?: string;
}
export type SeedStrategy = "frappe_doc_insert" | "frappe_site_seed" | "nextjs_factory" | "react_factory" | "django_fixture" | "laravel_factory" | "generic_sql";
export type E2EStrategy = "bench_site_browser_flow" | "next_dev_server_flow" | "vite_dev_server_flow" | "django_test_client_flow" | "laravel_dusk_flow" | "generic_playwright_flow";
export interface E2EScenario {
    id: string;
    name: string;
    description: string;
    steps: E2EStep[];
    required: boolean;
    tags?: string[];
}
export interface E2EStep {
    action: "navigate" | "click" | "type" | "wait" | "screenshot" | "assert" | "hover" | "select" | "upload";
    selector?: string;
    value?: string;
    timeout?: number;
    assertCondition?: string;
}
export interface E2EResult {
    scenarioId: string;
    status: "passed" | "failed" | "skipped" | "error";
    duration: number;
    stepsExecuted: number;
    stepsPassed: number;
    stepsFailed: number;
    screenshotPath?: string;
    tracePath?: string;
    videoPath?: string;
    errorMessage?: string;
    failedStep?: number;
    executedAt: string;
}
export interface E2EReport {
    jobId: string;
    scenarios: E2EScenario[];
    results: E2EResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        duration: number;
    };
    createdAt: string;
}
export interface RepairTask {
    id: string;
    originalTaskId: string;
    failureType: FailureType;
    description: string;
    attemptedFixes: AttemptedFix[];
    status: "pending" | "in_progress" | "resolved" | "escalated";
    retryPolicy: RetryPolicy;
    createdAt: string;
    resolvedAt?: string;
}
export type FailureType = "test_failure" | "e2e_failure" | "build_error" | "runtime_error" | "lint_error" | "type_error" | "quota_exhausted" | "provider_error" | "unknown";
export interface AttemptedFix {
    attempt: number;
    description: string;
    success: boolean;
    output?: string;
    timestamp: string;
}
export interface RetryPolicy {
    maxRetries: number;
    backoffMs: number;
    backoffMultiplier: number;
    escalationAfter?: number;
}
export interface WorktreeInfo {
    name: string;
    path: string;
    branch: string;
    jobId?: string;
    taskId?: string;
    createdAt: string;
    status: "active" | "merged" | "abandoned";
}
export interface LoopConfig {
    jobId: string;
    requirement: string;
    providerPolicy?: {
        plannerProvider: string;
        codeProviders: string[];
        reviewProvider: string;
        fallbackProviders: string[];
    };
    maxIterations?: number;
    checkpointInterval?: number;
    autoCheckpoint?: boolean;
    pauseOnQuota?: boolean;
    maxRepairAttempts?: number;
}
export interface LoopState {
    jobId: string;
    iteration: number;
    currentTaskId?: string | null;
    status: JobStatus;
    lastActivity?: string;
    lastCheckpoint?: RuntimeCheckpoint | null;
}
/** Why a compact was triggered */
export type CompactTriggerReason = "token_threshold" | "manual" | "output_limit" | "quota_exceeded" | "error";
/** A single tool-call result that can be microcompacted */
export interface CompactableToolResult {
    id: string;
    name: string;
    timestamp: number;
    tokens: number;
    content: string;
}
/**
 * A message in the compactable conversation history.
 * System-role messages are used as compact boundaries.
 */
export interface CompactableMessage {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    toolResults?: CompactableToolResult[];
    /** Arbitrary per-message metadata (e.g. model, usage stats) */
    metadata?: Record<string, unknown>;
}
/** Return type of every LLM invocation */
export interface InvokeResult {
    success: boolean;
    output?: string;
    error?: string;
    finishReason?: "stop" | "length" | "content_filter";
    usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
    };
    /** The model that generated this result (used for cost tracking) */
    model?: string;
}
/**
 * Options passed when invoking the LLM through CompactOrchestrator.
 * The orchestrator injects microcompact / full compact around this call.
 */
export interface InvokeWithCompactOptions {
    messages: CompactableMessage[];
    model: string;
    systemPrompt?: string;
    maxOutputTokens: number;
    tools?: Array<{
        name: string;
        description?: string;
        input_schema?: Record<string, unknown>;
    }>;
    /**
     * The actual LLM invoke function.
     * When provided in opts, the orchestrator uses it directly.
     * Otherwise the orchestrator falls back to callbacks.invokeAgent.
     */
    invokeAgent?: (opts: InvokeWithCompactOptions) => Promise<InvokeResult>;
}
/** What the orchestrator emits after a full compact */
export interface CompactResult {
    trigger: CompactTriggerReason;
    beforeTokens: number;
    afterTokens: number;
    messagesCompacted: number;
    summary?: string;
}
/** What the orchestrator emits as its final return value */
export interface OrchestratedInvokeResult extends InvokeResult {
    compactResult?: CompactResult;
    continueMessage?: string;
}
/** Callbacks the harness provides to CompactOrchestrator */
export interface CompactOrchestratorCallbacks {
    /** Called after every successful compaction with the result */
    onCheckpoint?: (result: CompactResult) => void;
    /** Called when a quota event occurs */
    onQuotaEvent?: (event: "paused" | "resumed" | "exhausted", provider?: string) => void;
    /**
     * Summarize messages via a forked agent.
     * Used by runFullCompact() instead of the main conversation.
     * Until RFC-0028 is fully wired, falls back to heuristic truncation.
     */
    summarizeViaForkedAgent?: (messages: CompactableMessage[], reason: CompactTriggerReason) => Promise<{
        summary: string;
        droppedCount: number;
    }>;
}
export { KNOWN_AI_PROVIDERS, PROVIDER_LABELS, SCRAPEABLE_PROVIDERS, TUI_SIGNAL_PROVIDERS, isKnownAiProvider, getProviderLabel, } from "./ai-providers.js";
export type { KnownAiProvider } from "./ai-providers.js";
//# sourceMappingURL=runtime-types.d.ts.map