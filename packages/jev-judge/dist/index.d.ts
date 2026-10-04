/**
 * Jev Judge - Main API
 *
 * Structured decision model for agent routing, E2E testing, and automated decisions.
 * Uses TypeSafe Jev via OpenRouter for fast, calibrated, hallucination-free decisions.
 *
 * @example
 * ```typescript
 * import { JevJudge } from "@pi-harness/jev-judge";
 *
 * const judge = new JevJudge({ apiKey: process.env.OPENROUTER_API_KEY! });
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
import type { JevJudgeConfig, JevQuestions, JevEvaluationResult, ThresholdDecision } from "./types.js";
/**
 * Environment variable keys for API keys
 */
export declare const ENV_KEYS: {
    readonly TYPESAFE_API_KEY: "TYPESAFE_API_KEY";
    readonly OPENROUTER_API_KEY: "OPENROUTER_API_KEY";
};
/**
 * Get API key from environment or keys file
 * Priority: TYPESAFE_API_KEY env > OPENROUTER_API_KEY env > keys file
 */
export declare function getApiKeyFromEnv(): string | undefined;
/**
 * Check if Jev API key is available
 */
export declare function hasJevApiKey(): boolean;
/**
 * Create JevJudge with auto-detected API key from environment
 */
export declare function createJevJudge(config?: Partial<JevJudgeConfig>): JevJudge;
/**
 * JevJudge - Main class for making structured decisions with Jev
 */
export declare class JevJudge {
    private client;
    private config;
    constructor(config: JevJudgeConfig);
    /**
     * Evaluate state against questions
     *
     * @param state - The context/situation to evaluate (text or structured)
     * @param questions - Map of question_id -> question definition
     * @returns Evaluation result with decisions
     */
    evaluate<T extends string>(state: string | object, questions: JevQuestions<T>): Promise<JevEvaluationResult<T>>;
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
    private buildDecision;
    private getConfidence;
}
export * from "./types.js";
export { E2EJudge } from "./e2e-judge.js";
export { FlakyDetector } from "./flaky-detector.js";
export { DecisionEngine } from "./decision-engine.js";
export { AutoContinueJudge, createTaskState } from "./auto-continue.js";
export type { TaskState, AutoContinueDecision, AutoContinueConfig } from "./auto-continue.js";
export { checkWrapUp, getTodoSummary } from "./wrap-up-judge.js";
export type { TodoItem, WrapUpResult } from "./wrap-up-judge.js";
export { EnvironmentJudge } from "./environment-judge.js";
export type { EnvironmentContext, EnvironmentDecision, SafetyCheck, EnvironmentConfig } from "./environment-judge.js";
//# sourceMappingURL=index.d.ts.map