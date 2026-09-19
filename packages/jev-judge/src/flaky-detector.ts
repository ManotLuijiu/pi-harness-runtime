/**
 * Flaky Detector - Specialized module for detecting flaky tests
 *
 * Uses Jev to analyze test failures and determine if they're flaky.
 */

import { JevJudge } from "./index.js";
import type { JevJudgeConfig, E2ETestResult, E2EFlakyAnalysis } from "./types.js";

// Known flaky patterns
const FLAKY_PATTERNS = {
  timeout: ["timeout", "timed out", "ETIMEDOUT", "TimeoutError"],
  network: ["ECONNREFUSED", "ENOTFOUND", "network", "fetch failed"],
  race_condition: [
    "race condition",
    "concurrent",
    "simultaneous",
    "out of order",
  ],
  ui_state: [
    "element not visible",
    "element not interactable",
    "stale element",
    "not attached",
  ],
};

/**
 * Flaky Detector - Specialized for detecting flaky test failures
 */
export class FlakyDetector {
  private judge: JevJudge;
  private threshold: number;

  constructor(config: JevJudgeConfig, threshold = 0.7) {
    this.judge = new JevJudge(config);
    this.threshold = threshold;
  }

  /**
   * Quick pattern-based flaky detection (without Jev)
   * Used for fast, synchronous checks
   */
  detectPattern(errorMessage?: string): {
    isFlaky: boolean;
    pattern: string | null;
    confidence: "high" | "medium" | "low";
  } {
    if (!errorMessage) {
      return {
        isFlaky: false,
        pattern: null,
        confidence: "low",
      };
    }

    const lowerError = errorMessage.toLowerCase();

    for (const [pattern, keywords] of Object.entries(FLAKY_PATTERNS)) {
      const matches = keywords.filter((kw) => lowerError.includes(kw.toLowerCase()));

      if (matches.length > 0) {
        return {
          isFlaky: true,
          pattern,
          confidence: matches.length >= 2 ? "high" : "medium",
        };
      }
    }

    return {
      isFlaky: false,
      pattern: null,
      confidence: "low",
    };
  }

  /**
   * AI-powered flaky detection with Jev
   */
  async detect(testResult: E2ETestResult): Promise<E2EFlakyAnalysis> {
    // First, quick pattern check
    const patternResult = this.detectPattern(testResult.error);

    // If pattern detection is confident, return early
    if (patternResult.confidence === "high") {
      return {
        isFlaky: patternResult.isFlaky,
        confidence: patternResult.confidence,
        probability: patternResult.isFlaky ? 0.95 : 0.05,
        pattern: patternResult.pattern ?? undefined,
        recommendation: patternResult.isFlaky ? "skip" : "investigate",
      };
    }

    // Use Jev for nuanced analysis
    const state = this.buildState(testResult);

    const result = await this.judge.evaluate(state, {
      isFlaky: {
        type: "noul",
        instructions:
          "Does this failure match a known flaky pattern? Consider: timeout, network issue, race condition, or intermittent UI state.",
      },
      patternType: {
        type: "choice",
        instructions: "What is the most likely cause?",
        options: [
          "timeout",
          "network_issue",
          "race_condition",
          "ui_intermittent",
          "resource_contention",
          "real_bug",
          "unknown",
        ],
      },
      confidence: {
        type: "noul",
        instructions:
          "Is this assessment based on clear evidence and likely to be correct?",
      },
    });

    const isFlakyDecision = result.decisions.isFlaky;
    const probability = isFlakyDecision.probability ?? 0.5;

    const patternDecision = result.decisions.patternType as {
      response: { choice: string };
    };

    return {
      isFlaky: probability >= this.threshold,
      confidence: isFlakyDecision.confidence,
      probability,
      pattern: patternDecision?.response?.choice,
      recommendation: this.getRecommendation(probability),
    };
  }

  /**
   * Batch detect flaky tests
   */
  async batchDetect(
    testResults: E2ETestResult[]
  ): Promise<Map<string, E2EFlakyAnalysis>> {
    const results = new Map<string, E2EFlakyAnalysis>();

    // Process in batches
    const BATCH_SIZE = 5;
    for (let i = 0; i < testResults.length; i += BATCH_SIZE) {
      const batch = testResults.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map((test) => this.detect(test))
      );

      for (let j = 0; j < batch.length; j++) {
        results.set(batch[j].name, batchResults[j]);
      }
    }

    return results;
  }

  private buildState(test: E2ETestResult): string {
    const parts: string[] = [`Test: ${test.name}`, `Status: ${test.status}`];

    if (test.error) {
      parts.push(`Error: ${test.error}`);
    }

    if (test.duration !== undefined) {
      parts.push(`Duration: ${test.duration}ms`);
    }

    if (test.retries !== undefined) {
      parts.push(`Previous retries: ${test.retries}`);
    }

    return parts.join("\n");
  }

  private getRecommendation(probability: number): "retry" | "skip" | "block" | "investigate" {
    if (probability >= 0.9) return "skip";
    if (probability >= 0.7) return "retry";
    if (probability >= 0.4) return "investigate";
    return "block";
  }
}
