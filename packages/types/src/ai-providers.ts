/**
 * AI Provider Registry
 *
 * Centralized, canonical list of known AI/LLM providers used as keys across
 * mirror.json, quota tracking, TUI signal parsing, and footer display.
 *
 * Adding a new provider = add ONE entry here + update the places that
 * need per-provider behaviour (scraper, TUI parser, footer, etc.).
 *
 * Provider ids are lowercase internal keys.
 * Labels are human-readable display strings.
 */

export const KNOWN_AI_PROVIDERS = [
	"minimax",
	"openai",
	"anthropic",
	"glm",
	"openrouter",
	"openai-codex",
	"deepseek",
	"gemini",
	"kimi",
] as const;

export type KnownAiProvider = (typeof KNOWN_AI_PROVIDERS)[number];

/** Human-readable display labels (used in footer, notifications). */
export const PROVIDER_LABELS: Record<string, string> = {
	minimax: "MiniMax",
	openai: "OpenAI",
	anthropic: "Anthropic",
	glm: "GLM",
	openrouter: "OpenRouter",
	"openai-codex": "OpenAI Codex",
	deepseek: "DeepSeek",
	gemini: "Gemini",
	kimi: "Kimi",
	unknown: "Unknown",
};

/**
 * Providers that support continuous quota scraping via cookie/browser automation.
 * Only MiniMax is currently supported here.
 */
export const SCRAPEABLE_PROVIDERS: KnownAiProvider[] = ["minimax"];

/**
 * Providers that report quota via TUI signal capture (one-shot on limit hit).
 * These do NOT have a continuous scraping path.
 */
export const TUI_SIGNAL_PROVIDERS: KnownAiProvider[] = [
	"openai",
	"openai-codex",
	"anthropic",
	"glm",
	"openrouter",
];

/**
 * Check if a provider id is a known AI provider.
 */
export function isKnownAiProvider(id: string): id is KnownAiProvider {
	return (KNOWN_AI_PROVIDERS as readonly string[]).includes(id);
}

/**
 * Get the display label for a provider id.
 * Falls back to the id itself if unknown.
 */
export function getProviderLabel(id: string): string {
	return PROVIDER_LABELS[id] ?? id;
}
