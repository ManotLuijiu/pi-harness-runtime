/**
 * TypeSafe Jev Provider - Direct API integration
 *
 * Uses TypeSafe's /v1/systemone endpoint directly.
 * This is the recommended provider for Jev decisions.
 *
 * API: POST https://api.typesafe.ai/v1/systemone
 * Auth: Bearer token (TYPESAFE_API_KEY)
 *
 * The request contract (choice criteria as a dictionary, score questions with
 * a mandatory rubric) is implemented in ./typesafe-request.ts; the mapping was
 * verified against the live endpoint.
 */
import type { JevQuestions, JevEvaluationResult } from "./types.js";
/**
 * TypeSafe provider configuration
 */
export interface TypeSafeConfig {
    apiKey: string;
    model?: string;
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
     * Build the API request and validate it against the API contract.
     *
     * The returned `request` is the wire format; `scoreScales` is local
     * bookkeeping and is never sent to the API (it rejects unknown fields).
     */
    private buildRequest;
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
 * Determine the provider that owns a base URL.
 *
 * The provider is derived from the ENDPOINT, never from the shape of a key:
 * guessing from a key is how an OpenRouter key ended up being sent to the
 * TypeSafe API.
 */
export declare function providerForBaseUrl(baseUrl: string): "typesafe" | "openrouter";
/**
 * Detect which provider to use based on API key or config
 *
 * @deprecated The provider cannot be derived from a key - a bare key says
 * nothing about the endpoint it belongs to, and guessing from its length is
 * how an OpenRouter key ended up being sent to the TypeSafe API. Pass the
 * `baseUrl` of the provider, or use `resolveJevProviders()` (see ./index.ts),
 * which binds every credential to its own provider.
 */
export declare function detectProvider(_apiKey: string, baseUrl?: string): "typesafe" | "openrouter";
//# sourceMappingURL=typesafe-provider.d.ts.map