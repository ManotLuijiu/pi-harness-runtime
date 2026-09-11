/**
 * Model factories — all models fully env-driven, no hardcoded defaults.
 *
 * Agent roles (configurable via env):
 *   planner  → GPT  (PLANNER_API_KEY, PLANNER_MODEL, PLANNER_BASE_URL)
 *   reviewer → GLM  (GLM_API_KEY,     GLM_MODEL,     GLM_BASE_URL)
 *   coder    → MiniMax (MINIMAX_API_KEY, MINIMAX_MODEL, MINIMAX_BASE_URL)
 *
 * Wiki: wiki/multi-agent-langchain.md
 */
import { ChatOpenAI } from "@langchain/openai";
export interface ModelOptions {
   /** Override model id (e.g. "gpt-5.6", "GLM-5.2", "MiniMax-M2") */
   model?: string;
   /** Override API base URL */
   baseURL?: string;
   /** Override API key */
   apiKey?: string;
   /** Sampling temperature */
   temperature?: number;
}
/**
 * Pre-resolved model config from model-router.ts.
 * Pass this to skip env-lookup and use the routed model directly.
 */
export interface ResolvedModelOptions {
   model: string;
   baseURL: string;
   apiKey: string;
   /** Sampling temperature */
   temperature?: number;
}
/**
 * Planner model — GPT family.
 *
 * Can be called with:
 *   - ModelOptions (override fields, rest from env)
 *   - ResolvedModelOptions (fully resolved from model-router, no env lookup)
 *
 * Env vars (when using ModelOptions):
 *   PLANNER_API_KEY   (required)
 *   PLANNER_MODEL     (required)
 *   PLANNER_BASE_URL  (required)
 */
export declare function createPlannerModel(
   opts?: ModelOptions | ResolvedModelOptions,
): ChatOpenAI;
/**
 * Reviewer model — GLM family (master reviewer per design).
 *
 * Can be called with:
 *   - ModelOptions (override fields, rest from env)
 *   - ResolvedModelOptions (fully resolved from model-router, no env lookup)
 *
 * Env vars (when using ModelOptions):
 *   GLM_API_KEY   (required)
 *   GLM_MODEL     (required)
 *   GLM_BASE_URL  (required)
 */
export declare function createReviewerModel(
   opts?: ModelOptions | ResolvedModelOptions,
): ChatOpenAI;
/**
 * Coder model — MiniMax family.
 *
 * Can be called with:
 *   - ModelOptions (override fields, rest from env)
 *   - ResolvedModelOptions (fully resolved from model-router, no env lookup)
 *
 * Env vars (when using ModelOptions):
 *   MINIMAX_API_KEY   (required)
 *   MINIMAX_MODEL     (required)
 *   MINIMAX_BASE_URL  (required)
 */
export declare function createCoderModel(
   opts?: ModelOptions | ResolvedModelOptions,
): ChatOpenAI;
//# sourceMappingURL=models.d.ts.map
