/**
 * Smart model router — reads the request prompt and decides which model to use
 * for each agent role at runtime. No hardcoded model IDs; all choices are driven
 * by env vars + optional per-request directives in the prompt.
 *
 * Per-request directives (optional — fallback to env defaults if absent):
 *
 *   Planner directive:
 *     [planner: gpt-5.6]   or  [planner: GLM-5.2]   or  [planner: MiniMax-M2]
 *
 *   Reviewer directive (master reviewer — GLM is the design default):
 *     [reviewer: GLM-5.2]  or  [reviewer: GPT-5.6]
 *
 *   Coder directive:
 *     [coder: MiniMax-M2]   or  [coder: gpt-5.6]
 *
 *   Examples in a prompt:
 *     "Implement X   [reviewer: GPT-5.6]  [planner: GLM-5.2]"
 *     "Use GLM as master reviewer for this task"
 *     "GPT as reviewer: please review this code"
 *
 *   The parser is forgiving — these all work:
 *     [reviewer: GLM]        → uses GLM_MODEL from env
 *     [reviewer: gpt]         → uses PLANNER_MODEL from env (same family)
 *     [reviewer: MiniMax]     → uses MINIMAX_MODEL from env
 *
 * Wiki: wiki/multi-agent-langchain.md
 */
/** Model options derived from a resolved env prefix. */
export interface ResolvedModel {
    model: string;
    baseURL: string;
    apiKey: string;
}
/** Result of routing a request to models. */
export interface RouteResult {
    planner: ResolvedModel;
    reviewer: ResolvedModel;
    coder: ResolvedModel;
    /** Text of the request with directive comments stripped (safe for agent prompts). */
    cleanRequest: string;
}
/**
 * Resolve a model family to actual env-backed model options.
 * family: "GLM" | "PLANNER" | "MINIMAX" (case-insensitive input)
 */
export declare function resolveModel(family: string): ResolvedModel;
/**
 * Route a request prompt to the correct model configuration.
 *
 * Algorithm:
 * 1. Extract [role: family] directives from the prompt
 * 2. Resolve each family to actual env-backed model options
 * 3. Apply defaults (planner→PLANNER, reviewer→GLM, coder→MINIMAX)
 * 4. Strip directive comments from the request before passing to agents
 */
export declare function routeRequest(request: string): RouteResult;
/**
 * Route a request, also scanning natural-language hints.
 * Directives ([role: family]) take precedence over natural hints.
 */
export declare function routeRequestSmart(request: string): RouteResult;
//# sourceMappingURL=model-router.d.ts.map