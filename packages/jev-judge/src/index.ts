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

import type {
  JevJudgeConfig,
  JevQuestion,
  JevQuestions,
  JevResponse,
  JevDecision,
  JevEvaluationResult,
  JevNoulResponse,
  JevChoiceResponse,
  JevScoreResponse,
  ThresholdDecision,
} from "./types.js";

// OpenAI SDK (OpenRouter is OpenAI-compatible)
// @ts-ignore - openai is installed at workspace root
import OpenAI from "openai";

/**
 * Environment variable keys for API keys
 */
export const ENV_KEYS = {
  TYPESAFE_API_KEY: "TYPESAFE_API_KEY",
  OPENROUTER_API_KEY: "OPENROUTER_API_KEY",
} as const;

/**
 * Get API key from environment or keys file
 * Priority: TYPESAFE_API_KEY env > OPENROUTER_API_KEY env > keys file
 */
export function getApiKeyFromEnv(): string | undefined {
  // First check environment variables
  const envKey =
    process.env[ENV_KEYS.TYPESAFE_API_KEY] ||
    process.env[ENV_KEYS.OPENROUTER_API_KEY];
  if (envKey) return envKey;

  // Fall back to keys file (e.g., ~/.pi-harness-runtime/keys/jev-api-key.txt)
  const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
  const keysDir = `${homedir}/.pi-harness-runtime/keys`;
  const keyFile = `${keysDir}/jev-api-key.txt`;

  try {
    const { readFileSync, existsSync } = require("fs");
    if (existsSync(keyFile)) {
      const key = readFileSync(keyFile, "utf8").trim();
      if (key && key.length > 10) {
        return key;
      }
    }
  } catch {
    // Ignore file read errors
  }

  return undefined;
}

/**
 * Check if Jev API key is available
 */
export function hasJevApiKey(): boolean {
  return !!getApiKeyFromEnv();
}

/**
 * Create JevJudge with auto-detected API key from environment
 */
export function createJevJudge(config?: Partial<JevJudgeConfig>): JevJudge {
  const apiKey = getApiKeyFromEnv();
  if (!apiKey) {
    throw new Error(
      `Jev API key not found. Set ${ENV_KEYS.TYPESAFE_API_KEY} or ${ENV_KEYS.OPENROUTER_API_KEY} in environment.`
    );
  }
  return new JevJudge({ apiKey, ...config });
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  baseUrl: "https://openrouter.ai/api/v1",
  model: "typesafe/jev-1.13",
  defaultThreshold: 0.7,
  timeoutMs: 30000,
};

/**
 * JevJudge - Main class for making structured decisions with Jev
 */
export class JevJudge {
  private client: OpenAI;
  private config: Required<JevJudgeConfig>;

  constructor(config: JevJudgeConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<JevJudgeConfig>;

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeoutMs,
    });
  }

  /**
   * Evaluate state against questions
   *
   * @param state - The context/situation to evaluate (text or structured)
   * @param questions - Map of question_id -> question definition
   * @returns Evaluation result with decisions
   */
  async evaluate<T extends string>(
    state: string | object,
    questions: JevQuestions<T>
  ): Promise<JevEvaluationResult<T>> {
    const startTime = Date.now();

    // Convert state to string if object
    const stateStr = typeof state === "string" ? state : JSON.stringify(state);

    // Build questions array for API
    const questionsArray = Object.entries(questions).map(([id, q]) => {
      const questionObj = q as JevQuestion;
      const entry: Record<string, unknown> = { id };
      if (questionObj.type === "noul") {
        entry.type = "noul";
        entry.instructions = questionObj.instructions;
      } else if (questionObj.type === "choice") {
        entry.type = "choice";
        entry.instructions = questionObj.instructions;
        entry.options = questionObj.options;
      } else if (questionObj.type === "score") {
        entry.type = "score";
        entry.instructions = questionObj.instructions;
        if (questionObj.min !== undefined) entry.min = questionObj.min;
        if (questionObj.max !== undefined) entry.max = questionObj.max;
      }
      return entry;
    });

    // Call Jev via OpenRouter
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        {
          role: "system",
          content: `You are a decision engine. Evaluate the following state and answer the questions.
Return your answers in the exact JSON format specified.`,
        },
        {
          role: "user",
          content: `State: ${stateStr}

Questions:
${JSON.stringify(questionsArray, null, 2)}

Respond with a JSON object mapping each question ID to its answer.`,
        },
      ],
      response_format: {
        type: "json_object",
      },
      temperature: 0.1, // Low temperature for consistent decisions
    });

    const latencyMs = Date.now() - startTime;

    // Parse response
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from Jev");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Invalid JSON response from Jev");
    }

    // Build decisions map
    const decisions = {} as Record<T, JevDecision<T>>;

    for (const [questionId, question] of Object.entries(questions)) {
      const questionData = question as JevQuestion;
      const responseData = (parsed as Record<string, unknown>)[questionId] as
        | JevResponse
        | undefined;

      if (!responseData) {
        continue;
      }

      const decision = this.buildDecision(
        questionId,
        questionData,
        responseData
      );
      (decisions as Record<string, JevDecision>)[questionId] = decision;
    }

    return {
      decisions,
      state: stateStr,
      latencyMs,
      model: this.config.model,
    };
  }

  /**
   * Quick noul (yes/no) evaluation
   */
  async noul(
    state: string | object,
    question: string
  ): Promise<{ noul: number; confidence: "high" | "medium" | "low" }> {
    const result = await this.evaluate(state, {
      answer: { type: "noul", instructions: question },
    });

    const decision = result.decisions.answer as JevDecision<"answer">;
    return {
      noul: (decision.response as JevNoulResponse).noul,
      confidence: decision.confidence,
    };
  }

  /**
   * Quick choice evaluation
   */
  async choice<T extends string>(
    state: string | object,
    question: string,
    options: T[]
  ): Promise<{ choice: T; confidence: number }> {
    const result = await this.evaluate(state, {
      answer: { type: "choice", instructions: question, options },
    });

    const decision = result.decisions.answer as JevDecision<"answer">;
    return {
      choice: (decision.response as JevChoiceResponse<T>).choice,
      confidence: (decision.response as JevChoiceResponse).confidence,
    };
  }

  /**
   * Make threshold-based decision
   */
  thresholdDecision(
    probability: number,
    threshold: number = this.config.defaultThreshold
  ): ThresholdDecision {
    const confidence = this.getConfidence(probability, threshold);

    return {
      shouldAct: probability >= threshold,
      probability,
      confidence,
      action: probability >= 0.9 ? "proceed" : probability >= 0.5 ? "review" : "block",
    };
  }

  /**
   * Batch evaluate multiple states
   */
  async batchEvaluate<T extends string>(
    states: (string | object)[],
    questions: JevQuestions<T>,
    options: { concurrency?: number } = {}
  ): Promise<JevEvaluationResult<T>[]> {
    const { concurrency = 3 } = options;

    const results: JevEvaluationResult<T>[] = [];
    const batches: (string | object)[] = [];

    // Split into batches
    for (let i = 0; i < states.length; i += concurrency) {
      batches.push(...states.slice(i, i + concurrency));
    }

    // Process batches
    for (const batch of batches) {
      const result = await this.evaluate(batch, questions);
      results.push(result);
    }

    return results;
  }

  // Private helpers

  // Note: Response schema removed - using json_object mode without strict schema
  // This allows Jev to return flexible responses

  private buildDecision<T extends string>(
    questionId: T,
    question: JevQuestion,
    response: JevResponse
  ): JevDecision<T> {
    let probability: number;
    let confidence: "high" | "medium" | "low";

    switch (response.type) {
      case "noul":
        probability = response.noul;
        break;
      case "choice":
        probability = response.confidence;
        break;
      case "score":
        // Normalize score to 0-1
        const max = question.type === "score" ? (question.max ?? 100) : 100;
        const min = question.type === "score" ? (question.min ?? 0) : 0;
        probability = (response.score - min) / (max - min);
        break;
    }

    confidence = this.getConfidence(probability, this.config.defaultThreshold);

    return {
      questionId,
      question,
      response,
      probability,
      confidence,
    };
  }

  private getConfidence(
    probability: number,
    threshold: number
  ): "high" | "medium" | "low" {
    const distance = Math.abs(probability - threshold);
    if (distance > 0.3) return "high";
    if (distance > 0.15) return "medium";
    return "low";
  }
}

// Export types
export * from "./types.js";

// Export submodules
export { E2EJudge } from "./e2e-judge.js";
export { FlakyDetector } from "./flaky-detector.js";
export { DecisionEngine } from "./decision-engine.js";
export { AutoContinueJudge, createTaskState } from "./auto-continue.js";
export type { TaskState, AutoContinueDecision, AutoContinueConfig } from "./auto-continue.js";
