/**
 * Model factories — GPT (planner/reviewer) + MiniMax (coder).
 *
 * MiniMax exposes an OpenAI-compatible chat completions API, so we reuse
 * ChatOpenAI with a baseURL override. All values are env-configurable.
 *
 * Wiki: wiki/multi-agent-langchain.md
 */
import { ChatOpenAI } from "@langchain/openai";
export interface ModelOptions {
    /** Override model id (e.g. "gpt-4o", "MiniMax-M2.1") */
    model?: string;
    /** Override API base URL */
    baseURL?: string;
    /** Override API key */
    apiKey?: string;
    /** Sampling temperature */
    temperature?: number;
}
/** GPT model — used for planning and code review. */
export declare function createPlannerModel(opts?: ModelOptions): ChatOpenAI;
/** Reviewer shares the GPT configuration (can be overridden). */
export declare function createReviewerModel(opts?: ModelOptions): ChatOpenAI;
/** MiniMax model — used for code generation (OpenAI-compatible endpoint). */
export declare function createCoderModel(opts?: ModelOptions): ChatOpenAI;
//# sourceMappingURL=models.d.ts.map