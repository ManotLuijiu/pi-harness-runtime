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

function gptDefaults(): { model: string; baseURL: string; apiKey: string } {
	const apiKey = process.env.OPENAI_API_KEY ?? "";
	if (!apiKey) {
		throw new Error(
			"OPENAI_API_KEY is not set. Add it to .env (see .env.example).",
		);
	}
	return {
		model: process.env.OPENAI_MODEL ?? "gpt-4o",
		// Optional override (proxies / gateways); defaults to the public endpoint
		baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
		apiKey,
	};
}

function minimaxDefaults(): {
	model: string;
	baseURL: string;
	apiKey: string;
} {
	const apiKey = process.env.MINIMAX_API_KEY ?? "";
	if (!apiKey) {
		throw new Error(
			"MINIMAX_API_KEY is not set. Add it to .env (see .env.example).",
		);
	}
	return {
		model: process.env.MINIMAX_MODEL ?? "MiniMax-M2",
		// International endpoint by default; China mainland: https://api.minimax.chat/v1
		baseURL: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1",
		apiKey,
	};
}

/** Build the `configuration.baseURL` override for ChatOpenAI (always set). */
function baseURLConfig(baseURL: string): {
	configuration: { baseURL: string };
} {
	return { configuration: { baseURL } };
}

/** GPT model — used for planning and code review. */
export function createPlannerModel(opts: ModelOptions = {}): ChatOpenAI {
	const d = gptDefaults();
	return new ChatOpenAI({
		model: opts.model ?? d.model,
		apiKey: opts.apiKey ?? d.apiKey,
		temperature: opts.temperature ?? 0.2,
		...baseURLConfig(opts.baseURL ?? d.baseURL),
	});
}

/** Reviewer shares the GPT configuration (can be overridden). */
export function createReviewerModel(opts: ModelOptions = {}): ChatOpenAI {
	const d = gptDefaults();
	return new ChatOpenAI({
		model: opts.model ?? d.model,
		apiKey: opts.apiKey ?? d.apiKey,
		temperature: opts.temperature ?? 0.1, // reviews want determinism
		...baseURLConfig(opts.baseURL ?? d.baseURL),
	});
}

/** MiniMax model — used for code generation (OpenAI-compatible endpoint). */
export function createCoderModel(opts: ModelOptions = {}): ChatOpenAI {
	const d = minimaxDefaults();
	return new ChatOpenAI({
		model: opts.model ?? d.model,
		apiKey: opts.apiKey ?? d.apiKey,
		temperature: opts.temperature ?? 0.3,
		...baseURLConfig(opts.baseURL ?? d.baseURL),
	});
}
