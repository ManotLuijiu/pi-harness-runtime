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
  /**
   * Candidate names.
   *
   * The TypeSafe API does not know about `options`: it expects `criteria` as a
   * DICTIONARY of `name -> description` (a list is rejected by the API with
   * 422 "Input should be a valid dictionary"). `options` stays the ergonomic
   * way to name the candidates.
   */
  options?: T[];
  /**
   * Choice criteria. A dictionary is used as-is; a list of names is converted
   * to a dictionary whose description is the name itself. Takes precedence
   * over `options`.
   */
  criteria?: Record<string, string> | string[];
  /** Optional description per option name (used together with `options`). */
  optionDescriptions?: Record<string, string>;
}

// Score: Rate something on a scale
export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  /** Lower bound of the reported scale (default 0). */
  min?: number;
  /** Upper bound of the reported scale (default 100). */
  max?: number;
  /**
   * Ordered rubric levels, lowest first.
   *
   * The TypeSafe API requires a rubric for score questions: the answer is the
   * probability-weighted POSITION in this list (0 .. levels-1), never an
   * arbitrary number. `min`/`max` only describe the scale the answer is
   * reported on; when no rubric is given one is derived from them.
   */
  criteria?: string[];
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
  /** The provider that served the request (when a provider chain is used). */
  provider?: JevProviderName;
}

// Threshold-based action decision
export interface ThresholdDecision {
  shouldAct: boolean;
  probability: number;
  confidence: "high" | "medium" | "low";
  action: "proceed" | "review" | "block";
}

// Provider identity
export type JevProviderName = "typesafe" | "openrouter";

/**
 * A provider bound to its OWN credential.
 *
 * Credentials are never shared between providers: a TypeSafe key is only ever
 * sent to the TypeSafe API and an OpenRouter key only to OpenRouter.
 */
export interface JevProviderConfig {
  provider: JevProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
}

// Config
export interface JevJudgeConfig {
  /**
   * Legacy single-provider key. Prefer `providers`: a bare key cannot be
   * bound to a provider, which is how an OpenRouter key used to end up being
   * sent to the TypeSafe API.
   */
  apiKey?: string;
  baseUrl?: string; // Defaults to the TypeSafe API
  model?: string; // Defaults to the provider's own model
  /**
   * Explicit provider chain, tried in order. A provider is only used for the
   * next attempt when the previous one failed with a retryable error
   * (network, timeout, rate limit, auth, 5xx) - never for a request contract
   * error, which is a bug that must stay visible.
   */
  providers?: JevProviderConfig[];
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
