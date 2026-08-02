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
export declare const KNOWN_AI_PROVIDERS: readonly ["minimax", "openai", "anthropic", "glm", "openrouter", "openai-codex", "deepseek", "gemini", "kimi"];
export type KnownAiProvider = (typeof KNOWN_AI_PROVIDERS)[number];
/** Human-readable display labels (used in footer, notifications). */
export declare const PROVIDER_LABELS: Record<string, string>;
/**
 * Providers that support continuous quota scraping via cookie/browser automation.
 * Only MiniMax is currently supported here.
 */
export declare const SCRAPEABLE_PROVIDERS: KnownAiProvider[];
/**
 * Providers that report quota via TUI signal capture (one-shot on limit hit).
 * These do NOT have a continuous scraping path.
 */
export declare const TUI_SIGNAL_PROVIDERS: KnownAiProvider[];
/**
 * Check if a provider id is a known AI provider.
 */
export declare function isKnownAiProvider(id: string): id is KnownAiProvider;
/**
 * Get the display label for a provider id.
 * Falls back to the id itself if unknown.
 */
export declare function getProviderLabel(id: string): string;
//# sourceMappingURL=ai-providers.d.ts.map