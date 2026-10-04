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
export type KnownProvider = "minimax" | "openai" | "openai-codex" | "glm" | "anthropic" | "openrouter";
/** True if the given string is a known, canonical provider id. */
export declare function isKnownAiProvider(value: string): value is KnownProvider;
export type ProviderId = KnownProvider | (string & {});
/** Return the provider id for a model id, or null if unknown. */
export declare function providerFromModelId(modelId: string | null | undefined): ProviderId | null;
/** Display name for the provider (used in the footer label). */
export declare function providerDisplayName(provider: ProviderId): string;
/** True if this provider has a continuous scrape path today (only MiniMax). */
/**
 * Providers with continuous quota scraping via browser/API.
 * - minimax: has both 5h and weekly windows
 * - openai: has weekly-only window (no 5h limit since 2026)
 */
export declare function providerHasContinuousScrape(provider: ProviderId): boolean;
/** True if this provider has a TUI-driven signal path today. */
export declare function providerHasTUISignal(provider: ProviderId): boolean;
//# sourceMappingURL=provider-id.d.ts.map