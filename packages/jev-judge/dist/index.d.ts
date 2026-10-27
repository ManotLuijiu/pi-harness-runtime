/**
 * Jev Judge - Main API
 *
 * Structured decision model for agent routing, E2E testing, and automated decisions.
 * Uses TypeSafe Jev via:
 * - Primary: TypeSafe direct API (https://api.typesafe.ai/v1/systemone)
 * - Fallback: OpenRouter API (https://openrouter.ai/api/v1)
 *
 * Every credential is bound to its own provider: a TypeSafe key is only ever
 * sent to the TypeSafe API and an OpenRouter key only to OpenRouter. The
 * fallback is explicit - the next provider is only used when the previous one
 * failed with a retryable error.
 *
 * @example
 * ```typescript
 * import { JevJudge, resolveJevProviders } from "@pi-harness/jev-judge";
 *
 * // Provider chain built from the environment / key files
 * const judge = new JevJudge({ providers: resolveJevProviders() });
 *
 * // Ask multiple questions at once
 * const result = await judge.evaluate(
 *   "The deploy failed with exit code 1",
 *   {
 *     isUrgent: { type: "noul", instructions: "Does this require immediate attention?" },
 *     severity: {
 *       type: "choice",
 *       instructions: "What is the severity level?",
 *       options: ["critical", "high", "medium", "low"]
 *     }
 *   }
 * );
 *
 * console.log(result.decisions.isUrgent.noul); // 0.92
 * ```
 */
import type { JevJudgeConfig, JevQuestions, JevEvaluationResult, ThresholdDecision, JevProviderConfig } from "./types.js";
/**
 * Environment variable keys for API keys
 */
export declare const ENV_KEYS: {
    readonly TYPESAFE_API_KEY: "TYPESAFE_API_KEY";
    readonly OPENROUTER_API_KEY: "OPENROUTER_API_KEY";
};
/** Default TypeSafe endpoint. */
export declare const TYPESAFE_BASE_URL = "https://api.typesafe.ai";
/** Default TypeSafe model (an alias served by the System One models). */
export declare const TYPESAFE_DEFAULT_MODEL = "jev-latest";
/** Default OpenRouter endpoint. */
export declare const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/**
 * Default OpenRouter model.
 *
 * `typesafe/jev-router` is the only TypeSafe model published on OpenRouter;
 * the previous default ("typesafe/systemone") is not in the catalog.
 */
export declare const OPENROUTER_DEFAULT_MODEL = "typesafe/jev-router";
/**
 * True when the key looks like an OpenRouter key.
 */
export declare function looksLikeOpenRouterKey(apiKey: string): boolean;
/**
 * Get the API key of the FIRST configured provider.
 *
 * The order is TypeSafe first, then OpenRouter. The returned key is NOT
 * bound to a provider by this function - use `resolveJevProviders()` to get
 * a provider chain where every credential belongs to its own endpoint.
 *
 * @deprecated Prefer `resolveJevProviders()`.
 */
export declare function getApiKeyFromEnv(): string | undefined;
/**
 * Resolve the provider chain from the environment and the key files.
 *
 * A provider is only included when its OWN credential is available:
 * - TypeSafe: TYPESAFE_API_KEY, or the key file typesafe-api-key.txt
 * - OpenRouter: OPENROUTER_API_KEY, or the key file openrouter-api-key.txt
 *
 * The legacy key file jev-api-key.txt is bound by the shape of the key it
 * holds: an "sk-or-" key is an OpenRouter key, everything else is treated as
 * a TypeSafe key. It is never sent to the wrong endpoint.
 *
 * The credentials are never crossed: the TypeSafe key is never sent to
 * OpenRouter and the OpenRouter key is never sent to TypeSafe.
 */
export declare function resolveJevProviders(options?: {
    env?: Record<string, string | undefined>;
    keysDir?: string;
}): JevProviderConfig[];
/**
 * Check if a Jev API key is available
 */
export declare function hasJevApiKey(): boolean;
/**
 * Create JevJudge with the provider chain resolved from the environment
 */
export declare function createJevJudge(config?: Partial<JevJudgeConfig>): JevJudge;
/**
 * JevJudge - Main class for making structured decisions with Jev
 *
 * Supports two providers:
 * - TypeSafe direct API (primary, recommended)
 * - OpenRouter API (fallback for backwards compatibility)
 */
export declare class JevJudge {
    private config;
    private providers;
    private typesafeJudges;
    private openrouterClients;
    constructor(config: JevJudgeConfig);
    /**
     * Build the provider chain.
     *
     * An explicit chain is used as-is. Otherwise the legacy single provider
     * configuration is turned into a one element chain; the credential then
     * belongs to the caller, who has to pass the matching baseUrl.
     */
    private resolveProviders;
    /**
     * Evaluate state against questions
     *
     * The provider chain is tried in order. The next provider is only used
     * when the previous one failed with a retryable error (network, timeout,
     * rate limit, auth, 5xx). A request contract error is never retried on
     * another provider: it is a bug that has to stay visible.
     *
     * @param state - The context/situation to evaluate (text or structured)
     * @param questions - Map of question_id -> question definition
     * @returns Evaluation result with decisions
     */
    evaluate<T extends string>(state: string | object, questions: JevQuestions<T>): Promise<JevEvaluationResult<T>>;
    private evaluateWithTypeSafe;
    /**
     * Evaluate through OpenRouter.
     *
     * OpenRouter is an OpenAI compatible endpoint, so the questions are
     * asked as a prompt and the answer is parsed as JSON. This path has its
     * own contract and does not use the TypeSafe request format.
     */
    private evaluateWithOpenRouter;
    /**
     * Quick noul (yes/no) evaluation
     */
    noul(state: string | object, question: string): Promise<{
        noul: number;
        confidence: "high" | "medium" | "low";
    }>;
    /**
     * Quick choice evaluation
     */
    choice<T extends string>(state: string | object, question: string, options: T[]): Promise<{
        choice: T;
        confidence: number;
    }>;
    /**
     * Make threshold-based decision
     */
    thresholdDecision(probability: number, threshold?: number): ThresholdDecision;
    /**
     * Batch evaluate multiple states
     */
    batchEvaluate<T extends string>(states: (string | object)[], questions: JevQuestions<T>, options?: {
        concurrency?: number;
    }): Promise<JevEvaluationResult<T>[]>;
    /**
     * The provider chain in use.
     */
    getProviders(): JevProviderConfig[];
    private buildDecision;
    private getConfidence;
}
export * from "./types.js";
export { JevProviderError, isRetryableStatus, toProviderError } from "./provider-error.js";
export type { JevProviderErrorOptions } from "./provider-error.js";
export { E2EJudge } from "./e2e-judge.js";
export { FlakyDetector } from "./flaky-detector.js";
export { DecisionEngine } from "./decision-engine.js";
export { AutoContinueJudge, createTaskState } from "./auto-continue.js";
export type { TaskState, AutoContinueDecision, AutoContinueConfig, DecisionScope, DecisionOutcome, DecisionContext, PendingQuestionContext, } from "./auto-continue.js";
export { buildAutonomyInstruction, AUTONOMY_INSTRUCTION_HEADER, } from "./autonomy-instruction.js";
export type { AutonomyInstructionInput } from "./autonomy-instruction.js";
export { classifyQuestionRisk } from "./question-risk.js";
export type { QuestionRiskFacts, QuestionRiskInput } from "./question-risk.js";
export { checkWrapUp, getTodoSummary } from "./wrap-up-judge.js";
export type { WrapUpResult } from "./wrap-up-judge.js";
export { EnvironmentJudge } from "./environment-judge.js";
export type { EnvironmentContext, EnvironmentDecision, SafetyCheck, EnvironmentConfig } from "./environment-judge.js";
export { TypeSafeJudge, detectProvider, providerForBaseUrl } from "./typesafe-provider.js";
export type { TypeSafeConfig } from "./typesafe-provider.js";
export { buildChoiceCriteria, buildScoreScale, scorePositionToProbability, scorePositionToValue, validateQuestion, MAX_SCORE_LEVELS, } from "./typesafe-request.js";
export type { ScoreScale, TypeSafeChoiceCriteria } from "./typesafe-request.js";
export { TodoContinuationController, createTodoContinuation } from "./continuation-controller.js";
export type { ContinuationConfig, ContinuationState, ContinuationResult } from "./continuation-controller.js";
export { createTodoProvider } from "./todo-provider.js";
export type { TodoProvider, TodoAvailability, TodoItem, TodoStatus, TodoSnapshot, TodoContext } from "./todo-provider.js";
export { parseValidationPlan, formatValidationContext, buildValidationSteerSuffix, describeTier, parseTier, parseDurationMs, formatDuration, summarizeValidationState, validationBudgetStatus, planWorkload, planHasPilot, } from "./validation-plan.js";
export type { ValidationPlan, ValidationTier, ValidationTierKind, ValidationState, ValidationTierState, ValidationBudgetStatus, } from "./validation-plan.js";
export { ValidationLedger, defaultLedgerPath, parseRunRecord, parseLedgerContent, } from "./validation-ledger.js";
export type { ValidationRunRecord, ValidationRunStatus, ValidationLedgerOptions, } from "./validation-ledger.js";
export { buildPilotPlan, describePilot, evaluatePilot, pilotTier, scaleUpTier, scaleUpWaitsForPilot, tierKindOf, } from "./pilot.js";
export type { MeasuredRun, PilotPlanInput, PilotVerdict, } from "./pilot.js";
export { buildBatches, batchProgress, describeBatches, estimateJobMs, mayStartScaleUp, nextBatches, overBudget, recordBatchResult, } from "./batch-plan.js";
export type { Batch, BatchKind, BatchPlan, BatchProgress, BatchResult, BatchStatus, } from "./batch-plan.js";
export { assessWorkload, declaredRecordCount, describeWorkload, workloadBatchPlan, LARGE_RECORD_COUNT, MEDIUM_RECORD_COUNT, LARGE_FILE_COUNT, MEDIUM_FILE_COUNT, LARGE_CALL_SITES, MEDIUM_CALL_SITES, LARGE_DURATION_MS, MEDIUM_DURATION_MS, PILOT_RECORDS, MAX_BATCH_RECORDS, MAX_CONCURRENCY, } from "./workload.js";
export type { WorkloadAssessment, WorkloadInput, WorkloadScopeFacts, WorkloadSize, WorkloadTierFacts, } from "./workload.js";
export { tieBreakValidation, formatTieBreaker, } from "./validation-tie-breaker.js";
export type { ValidationVerdict, ValidationTieBreaker } from "./validation-tie-breaker.js";
export { TaskIntakeController, createTaskIntake } from "./task-intake.js";
export type { TaskIntakeConfig, TaskIntakeResult } from "./task-intake.js";
//# sourceMappingURL=index.d.ts.map