/**
 * TypeSafe Jev Provider - Direct API integration
 *
 * Uses TypeSafe's /v1/systemone endpoint directly.
 * This is the recommended provider for Jev decisions.
 *
 * API: POST https://api.typesafe.ai/v1/systemone
 * Auth: Bearer token (TYPESAFE_API_KEY)
 */
import type { JevQuestions, JevEvaluationResult } from "./types.js";
/**
 * TypeSafe provider configuration
 */
export interface TypeSafeConfig {
    apiKey: string;
    baseUrl?: string;
    timeoutMs?: number;
}
/**
 * TypeSafe Jev Judge - Direct TypeSafe API integration
 *
 * Uses TypeSafe's systemone API for structured decisions.
 * More reliable than OpenRouter proxy and supports full feature set.
 */
export declare class TypeSafeJudge {
    private config;
    constructor(config: TypeSafeConfig);
    /**
     * Evaluate state against questions using TypeSafe API
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
     * Quick score evaluation
     */
    score(state: string | object, question: string, min?: number, max?: number): Promise<{
        score: number;
        confidence: number;
    }>;
    /**
     * Build JevDecision from TypeSafe answer
     */
    private buildDecision;
    /**
     * Determine confidence level from probability
     */
    private getConfidence;
}
/**
 * Detect which provider to use based on API key or config
 */
export declare function detectProvider(apiKey: string, baseUrl?: string): "typesafe" | "openrouter";
//# sourceMappingURL=typesafe-provider.d.ts.map