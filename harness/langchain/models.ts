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

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Build the `configuration.baseURL` override for ChatOpenAI. */
function baseURLConfig(baseURL: string): {
	configuration: { baseURL: string };
} {
	return { configuration: { baseURL } };
}

/** Env-var tuple for a single model family. */
interface ModelEnv {
	model: string;
	baseURL: string;
	apiKey: string;
}

/** Read env vars for a model family. Throws if the API key is absent. */
function readEnv(prefix: string, env: typeof process.env): ModelEnv {
	const apiKey = env[`${prefix}_API_KEY`] ?? "";
	if (!apiKey) {
		throw new Error(
			`${prefix}_API_KEY is not set. Add it to .env (see .env.example).\n` +
				`  Example: ${prefix}_MODEL="GLM-5.2" ${prefix}_BASE_URL="https://api.z.ai/api/v1"`,
		);
	}
	return {
		apiKey,
		model:
			env[`${prefix}_MODEL`] ??
			(() => {
				throw new Error(
					`${prefix}_MODEL is not set. Set it in .env (e.g. ${prefix}_MODEL="GLM-5.2").`,
				);
			})(),
		baseURL:
			env[`${prefix}_BASE_URL`] ??
			(() => {
				throw new Error(
					`${prefix}_BASE_URL is not set. Set it in .env (e.g. ${prefix}_BASE_URL="https://api.openai.com/v1").`,
				);
			})(),
	};
}

// ─── Model factories ─────────────────────────────────────────────────────────

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
export function createPlannerModel(
	opts: ModelOptions | ResolvedModelOptions = {},
): ChatOpenAI {
	const resolved = "baseURL" in opts ? opts : readEnv("PLANNER", process.env);
	// resolved.baseURL is always a string (readEnv throws if absent); cast is safe
	const baseURL = (opts.baseURL ?? resolved.baseURL) as string;
	return new ChatOpenAI({
		model: opts.model ?? resolved.model,
		apiKey: opts.apiKey ?? resolved.apiKey,
		temperature: opts.temperature ?? 0.2,
		...baseURLConfig(baseURL),
	});
}

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
export function createReviewerModel(
	opts: ModelOptions | ResolvedModelOptions = {},
): ChatOpenAI {
	const resolved = "baseURL" in opts ? opts : readEnv("GLM", process.env);
	const baseURL = (opts.baseURL ?? resolved.baseURL) as string;
	return new ChatOpenAI({
		model: opts.model ?? resolved.model,
		apiKey: opts.apiKey ?? resolved.apiKey,
		temperature: opts.temperature ?? 0.1,
		...baseURLConfig(baseURL),
	});
}

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
export function createCoderModel(
	opts: ModelOptions | ResolvedModelOptions = {},
): ChatOpenAI {
	const resolved = "baseURL" in opts ? opts : readEnv("MINIMAX", process.env);
	const baseURL = (opts.baseURL ?? resolved.baseURL) as string;
	return new ChatOpenAI({
		model: opts.model ?? resolved.model,
		apiKey: opts.apiKey ?? resolved.apiKey,
		temperature: opts.temperature ?? 0.3,
		...baseURLConfig(baseURL),
	});
}
