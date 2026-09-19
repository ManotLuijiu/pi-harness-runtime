/**
 * Jev Judge - Type definitions
 *
 * Jev is a System One model from TypeSafe AI that makes fast, structured decisions
 * with calibrated probabilities. Available via OpenRouter: typesafe/jev-1.13
 */

// Question types supported by Jev
export type JevQuestionType = "noul" | "choice" | "score";

// Noul: Yes/No question (returns probability 0-1)
export interface JevNoulQuestion {
  type: "noul";
  instructions: string;
}

// Choice: Select from options (returns selected option)
export interface JevChoiceQuestion<T extends string = string> {
  type: "choice";
  instructions: string;
  options: T[];
}

// Score: Rate something 0-100
export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  min?: number;
  max?: number;
}

// Any question type
export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

// Questions map (question_id -> question)
export type JevQuestions<T extends string = string> = Partial<
  Record<T, JevQuestion>
>;

// Response types
export interface JevNoulResponse {
  type: "noul";
  noul: number; // 0-1 probability
}

export interface JevChoiceResponse<T extends string = string> {
  type: "choice";
  choice: T;
  confidence: number; // 0-1
}

export interface JevScoreResponse {
  type: "score";
  score: number;
  confidence: number; // 0-1
}

// Any response type
export type JevResponse = JevNoulResponse | JevChoiceResponse | JevScoreResponse;

// Response map
export type JevResponses<T extends string = string> = Partial<Record<T, JevResponse>>;

// Decision result with metadata
export interface JevDecision<T extends string = string> {
  questionId: T;
  question: JevQuestion;
  response: JevResponse;
  probability?: number; // Extracted for easy access (noul = noul value, choice = confidence)
  confidence: "high" | "medium" | "low";
}

// Full evaluation result
export interface JevEvaluationResult<T extends string = string> {
  decisions: Record<T, JevDecision<T>>;
  state: string;
  latencyMs: number;
  model: string;
}

// Threshold-based action decision
export interface ThresholdDecision {
  shouldAct: boolean;
  probability: number;
  confidence: "high" | "medium" | "low";
  action: "proceed" | "review" | "block";
}

// Config
export interface JevJudgeConfig {
  apiKey: string;
  baseUrl?: string; // Defaults to OpenRouter
  model?: string; // Defaults to typesafe/jev-1.13
  defaultThreshold?: number; // Default 0.7
  timeoutMs?: number;
}

// E2E Test Judge types
export interface E2ETestResult {
  name: string;
  status: "passed" | "failed" | "skipped" | "pending";
  duration?: number; // ms
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
