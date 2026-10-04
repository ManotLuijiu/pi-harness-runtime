/**
 * Jev Judge - Type definitions
 *
 * Jev is a System One model from TypeSafe AI that makes fast, structured decisions
 * with calibrated probabilities. Available via OpenRouter: typesafe/jev-1.13
 */
export type JevQuestionType = "noul" | "choice" | "score";
export interface JevNoulQuestion {
    type: "noul";
    instructions: string;
}
export interface JevChoiceQuestion<T extends string = string> {
    type: "choice";
    instructions: string;
    options: T[];
}
export interface JevScoreQuestion {
    type: "score";
    instructions: string;
    min?: number;
    max?: number;
}
export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;
export type JevQuestions<T extends string = string> = Partial<Record<T, JevQuestion>>;
export interface JevNoulResponse {
    type: "noul";
    noul: number;
}
export interface JevChoiceResponse<T extends string = string> {
    type: "choice";
    choice: T;
    confidence: number;
}
export interface JevScoreResponse {
    type: "score";
    score: number;
    confidence: number;
}
export type JevResponse = JevNoulResponse | JevChoiceResponse | JevScoreResponse;
export type JevResponses<T extends string = string> = Partial<Record<T, JevResponse>>;
export interface JevDecision<T extends string = string> {
    questionId: T;
    question: JevQuestion;
    response: JevResponse;
    probability?: number;
    confidence: "high" | "medium" | "low";
}
export interface JevEvaluationResult<T extends string = string> {
    decisions: Record<T, JevDecision<T>>;
    state: string;
    latencyMs: number;
    model: string;
}
export interface ThresholdDecision {
    shouldAct: boolean;
    probability: number;
    confidence: "high" | "medium" | "low";
    action: "proceed" | "review" | "block";
}
export interface JevJudgeConfig {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    defaultThreshold?: number;
    timeoutMs?: number;
}
export interface E2ETestResult {
    name: string;
    status: "passed" | "failed" | "skipped" | "pending";
    duration?: number;
    error?: string;
    screenshot?: string;
    consoleLogs?: string[];
    networkLogs?: string[];
    retries?: number;
}
export interface E2EFlakyAnalysis {
    isFlaky: boolean;
    confidence: "high" | "medium" | "low";
    probability: number;
    pattern?: string;
    recommendation: "retry" | "skip" | "block" | "investigate";
}
export interface E2EBuildDecision {
    shouldBlock: boolean;
    probability: number;
    confidence: "high" | "medium" | "low";
    reason: string;
    affectedTests: string[];
}
export interface E2ERetryDecision {
    shouldRetry: boolean;
    maxAttempts: number;
    probability: number;
    delayMs?: number;
}
//# sourceMappingURL=types.d.ts.map