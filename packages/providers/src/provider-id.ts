/**
 * Provider ID — single source of truth for "which provider does this model id belong to".
 *
 * Used by:
 *   - `index.ts` to gate fetcher calls (replaces the old `isMiniMaxModel` check)
 *   - `mirror.ts` to key per-provider records
 *   - the footer renderer to label lines correctly
 *   - the cookie sanitizer and quota manager
 *
 * Provider boundaries (model-id prefix → provider id):
 *
 * | Model id prefix | Provider       | Notes                                |
 * |-----------------|----------------|--------------------------------------|
 * | `minimax/`      | minimax        | Playwright scrape path                |
 * | `openai/`       | openai         | TUI signal path                       |
 * | `openai-codex/` | openai-codex   | OAuth (different auth shape)          |
 * | `zai/`          | glm            | Z.ai / Zhipu                         |
 * | `zhipu/`        | glm            | alt alias                            |
 * | `anthropic/`    | anthropic      | TUI signal path                       |
 * | `openrouter/`   | openrouter     | TUI signal path                       |
 * | other           | null           | unknown — caller decides default     |
 *
 * Match is case-insensitive on the prefix portion.
 *
 * The set is intentionally small and explicit. To add a provider: add
 * a row to MODEL_PREFIXES and to the sanitization doc in
 * wiki/bugs/multi-provider-usage-status.md.
 */

export type KnownProvider =
	| "minimax"
	| "openai"
	| "openai-codex"
	| "glm"
	| "anthropic"
	| "openrouter";

/** True if the given string is a known, canonical provider id. */
export function isKnownAiProvider(value: string): value is KnownProvider {
	return (
		value === "minimax" ||
		value === "openai" ||
		value === "openai-codex" ||
		value === "glm" ||
		value === "anthropic" ||
		value === "openrouter"
	);
}

export type ProviderId = KnownProvider | (string & {});

const MODEL_PREFIXES: Array<{ prefix: string; provider: ProviderId }> = [
	{ prefix: "minimax/", provider: "minimax" },
	{ prefix: "openai-codex/", provider: "openai-codex" },
	{ prefix: "openai/", provider: "openai" },
	{ prefix: "anthropic/", provider: "anthropic" },
	{ prefix: "openrouter/", provider: "openrouter" },
	{ prefix: "zai/", provider: "glm" },
	{ prefix: "zhipu/", provider: "glm" },
];

/** Return the provider id for a model id, or null if unknown. */
export function providerFromModelId(
	modelId: string | null | undefined,
): ProviderId | null {
	if (!modelId || typeof modelId !== "string") return null;
	const lower = modelId.toLowerCase();
	for (const { prefix, provider } of MODEL_PREFIXES) {
		if (lower.startsWith(prefix)) return provider;
	}
	// Some model ids may be just the provider name (no `/` separator) —
	// common when the user picks via a friendly picker.
	if (lower.startsWith("minimax")) return "minimax";
	if (lower.startsWith("openai-codex")) return "openai-codex";
	if (lower.startsWith("openai")) return "openai";
	if (lower.startsWith("anthropic") || lower.startsWith("claude"))
		return "anthropic";
	if (lower.startsWith("openrouter")) return "openrouter";
	if (
		lower.startsWith("zai") ||
		lower.startsWith("zhipu") ||
		lower.startsWith("glm")
	)
		return "glm";
	return null;
}

/** Display name for the provider (used in the footer label). */
export function providerDisplayName(provider: ProviderId): string {
	switch (provider) {
		case "minimax":
			return "MiniMax";
		case "openai":
			return "OpenAI";
		case "openai-codex":
			return "OpenAI Codex";
		case "glm":
			return "GLM";
		case "anthropic":
			return "Anthropic";
		case "openrouter":
			return "OpenRouter";
		default:
			return provider;
	}
}

/** True if this provider has a continuous scrape path today (only MiniMax). */
export function providerHasContinuousScrape(provider: ProviderId): boolean {
	return provider === "minimax";
}

/** True if this provider has a TUI-driven signal path today. */
export function providerHasTUISignal(provider: ProviderId): boolean {
	return (
		provider === "openai" ||
		provider === "openai-codex" ||
		provider === "glm" ||
		provider === "anthropic" ||
		provider === "openrouter"
	);
}
