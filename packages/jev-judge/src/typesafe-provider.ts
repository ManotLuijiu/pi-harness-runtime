/**
 * TypeSafe Jev Provider - Direct API integration
 *
 * Uses TypeSafe's /v1/systemone endpoint directly.
 * This is the recommended provider for Jev decisions.
 *
 * API: POST https://api.typesafe.ai/v1/systemone
 * Auth: Bearer token (TYPESAFE_API_KEY)
 */

import type {
  JevQuestion,
  JevQuestions,
  JevResponse,
  JevDecision,
  JevEvaluationResult,
  JevNoulResponse,
  JevChoiceResponse,
  JevScoreResponse,
} from "./types.js";

/**
 * TypeSafe API request format
 */
interface TypeSafeRequest {
  /** The model that handles the request. Required. */
  model: string;
  /** The content to evaluate. */
  state: string | object | unknown[];
  /** A map of typed questions. Keys are question IDs. */
  questions: Record<string, TypeSafeQuestion>;
}

/**
 * TypeSafe question format (per API spec, id not needed in question object - it's the map key)
 */
interface TypeSafeQuestion {
  type: "noul" | "choice" | "score";
  instructions: string;
  options?: string[];           // For choice type
  criteria?: string[];          // For choice type - ordered criteria
  min?: number;                 // For score type
  max?: number;                 // For score type
}

/**
 * TypeSafe API response format
 */
interface TypeSafeResponse {
  answers: Record<string, TypeSafeAnswer>;
  model?: string;
  latency_ms?: number;
}

/**
 * TypeSafe answer format
 */
interface TypeSafeAnswer {
  type: "noul" | "choice" | "score";
  /** For noul type: probability of yes (0-1). */
  noul?: number;
  /** For choice type: the selected option. */
  choice?: string;
  /** For score type: the probability-weighted score. */
  score?: number;
  /** For choice/score: confidence 0-1. */
  confidence?: number;
}

/**
 * TypeSafe provider configuration
 */
export interface TypeSafeConfig {
  apiKey: string;
  model?: string;              // Defaults to jev-latest
  baseUrl?: string;            // Defaults to https://api.typesafe.ai
  timeoutMs?: number;          // Defaults to 30000
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  model: "jev-latest",
  baseUrl: "https://api.typesafe.ai",
  timeoutMs: 30000,
};

/**
 * TypeSafe Jev Judge - Direct TypeSafe API integration
 *
 * Uses TypeSafe's systemone API for structured decisions.
 * More reliable than OpenRouter proxy and supports full feature set.
 */
export class TypeSafeJudge {
  private config: Required<TypeSafeConfig>;

  constructor(config: TypeSafeConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<TypeSafeConfig>;
  }

  /**
   * Evaluate state against questions using TypeSafe API
   */
  async evaluate<T extends string>(
    state: string | object,
    questions: JevQuestions<T>
  ): Promise<JevEvaluationResult<T>> {
    const startTime = Date.now();

    // Convert state to string if object
    const stateStr = typeof state === "string" ? state : JSON.stringify(state);

    // Build TypeSafe question format as a map (not array)
    const questionsMap: Record<string, TypeSafeQuestion> = {};
    for (const [id, q] of Object.entries(questions)) {
      const questionObj = q as JevQuestion;
      questionsMap[id] = {
        type: questionObj.type,
        instructions: questionObj.instructions,
      };

      if (questionObj.type === "choice") {
        questionsMap[id].options = questionObj.options;
        // For choice questions, criteria defines ordered preference levels
        questionsMap[id].criteria = questionObj.options;
      } else if (questionObj.type === "score") {
        questionsMap[id].min = questionObj.min ?? 0;
        questionsMap[id].max = questionObj.max ?? 100;
      }
    }

    // Call TypeSafe API directly
    const response = await fetch(`${this.config.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        questions: questionsMap,
        state: stateStr,
      } satisfies TypeSafeRequest),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`TypeSafe API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as TypeSafeResponse;

    // Build decisions map
    const decisions = {} as Record<T, JevDecision<T>>;

    for (const [questionId, question] of Object.entries(questions)) {
      const questionData = question as JevQuestion;
      const answer = data.answers?.[questionId] as TypeSafeAnswer | undefined;

      // Reject missing required answers
      if (!answer) {
        throw new Error(`TypeSafe API: missing answer for required question "${questionId}"`);
      }

      const decision = this.buildDecision(
        questionId,
        questionData,
        answer
      );
      (decisions as Record<string, JevDecision>)[questionId] = decision;
    }

    return {
      decisions,
      state: stateStr,
      latencyMs,
      model: data.model ?? "typesafe/systemone",
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
    const noulResponse = decision.response as JevNoulResponse;
    return {
      noul: noulResponse.noul,
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
    const choiceResponse = decision.response as JevChoiceResponse<T>;
    return {
      choice: choiceResponse.choice,
      confidence: choiceResponse.confidence,
    };
  }

  /**
   * Quick score evaluation
   */
  async score(
    state: string | object,
    question: string,
    min = 0,
    max = 100
  ): Promise<{ score: number; confidence: number }> {
    const result = await this.evaluate(state, {
      answer: { type: "score", instructions: question, min, max },
    });

    const decision = result.decisions.answer as JevDecision<"answer">;
    const scoreResponse = decision.response as JevScoreResponse;
    return {
      score: scoreResponse.score,
      confidence: scoreResponse.confidence,
    };
  }

  /**
   * Build JevDecision from TypeSafe answer
   */
  private buildDecision<T extends string>(
    questionId: T,
    question: JevQuestion,
    answer: TypeSafeAnswer
  ): JevDecision<T> {
    let response: JevResponse;
    let probability: number;

    switch (answer.type) {
      case "noul":
        // FIX: Validate noul value is present and in range [0, 1]
        if (answer.noul === undefined || answer.noul === null) {
          throw new Error(`TypeSafe API: missing noul value for question "${questionId}"`);
        }
        if (typeof answer.noul !== "number" || isNaN(answer.noul)) {
          throw new Error(`TypeSafe API: invalid noul value for question "${questionId}": ${JSON.stringify(answer.noul)}`);
        }
        if (answer.noul < 0 || answer.noul > 1) {
          throw new Error(`TypeSafe API: noul value out of range [0,1] for question "${questionId}": ${answer.noul}`);
        }
        response = {
          type: "noul",
          noul: answer.noul,
        };
        probability = answer.noul;
        break;

      case "choice":
        response = {
          type: "choice",
          choice: answer.choice ?? question.type === "choice" ? (question as { options: string[] }).options[0] : "",
          confidence: answer.confidence ?? 0.5,
        };
        probability = answer.confidence ?? 0.5;
        break;

      case "score":
        const min = question.type === "score" ? (question as { min?: number }).min ?? 0 : 0;
        const max = question.type === "score" ? (question as { max?: number }).max ?? 100 : 100;
        response = {
          type: "score",
          score: answer.score ?? (min + max) / 2,
          confidence: answer.confidence ?? 0.5,
        };
        // Normalize score to 0-1
        probability = ((answer.score ?? (min + max) / 2) - min) / (max - min);
        break;

      default:
        // Fallback for unknown types
        response = {
          type: "noul",
          noul: 0.5,
        };
        probability = 0.5;
    }

    const confidence = this.getConfidence(answer.confidence ?? probability);

    return {
      questionId,
      question,
      response,
      probability,
      confidence,
    };
  }

  /**
   * Determine confidence level from probability
   */
  private getConfidence(probability: number): "high" | "medium" | "low" {
    // Confidence is based on distance from 0.5 (uncertain)
    const distance = Math.abs(probability - 0.5);
    if (distance > 0.35) return "high";
    if (distance > 0.2) return "medium";
    return "low";
  }
}

/**
 * Detect which provider to use based on API key or config
 */
export function detectProvider(
  apiKey: string,
  baseUrl?: string
): "typesafe" | "openrouter" {
  // If baseUrl is explicitly set to TypeSafe, use TypeSafe
  if (baseUrl?.includes("typesafe.ai")) {
    return "typesafe";
  }
  // If using OpenRouter URL, use OpenRouter
  if (baseUrl?.includes("openrouter")) {
    return "openrouter";
  }
  // If key looks like TypeSafe (no specific pattern known), prefer TypeSafe
  // TypeSafe keys are typically longer than OpenAI-compatible keys
  if (apiKey.length > 50) {
    return "typesafe";
  }
  // Default to OpenRouter for short keys (OpenAI-compatible)
  return "openrouter";
}
