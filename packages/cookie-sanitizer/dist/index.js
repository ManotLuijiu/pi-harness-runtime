/**
 * Cookie Sanitizer — public API.
 *
 * Forgiving input → strict canonical cache for downstream consumers
 * (e.g. MiniMaxQuotaScraper reads only `~/.config/minimax-cookies.txt`).
 *
 * The package is provider-agnostic but currently shipping with:
 *   - filename hints: minimax, anthropic, openai, glm, openrouter
 *   - domain hints : the matching provider domains
 *
 * Inputs accepted (auto-detected per file):
 *   - Netscape HTTP Cookie File
 *   - EditThisCookie / Chrome devtools JSON export
 *
 * @example
 * ```typescript
 * import { sync, hasAnyCookieSource, CookieWatcher } from "@pi-harness/cookie-sanitizer";
 *
 * // One-shot sync.
 * const result = sync();
 * console.log(result.provider, result.cachePath, result.totalCookies);
 *
 * // Live updates.
 * const watcher = new CookieWatcher({
 *   dropDir: "~/.pi-harness-runtime/cookies",
 *   onEvent: (e) => console.log(e),
 * });
 * watcher.start();
 * ```
 */
export { sync, hasAnyCookieSource, inferCachePath, enumerateDropFiles, readInputFile, DEFAULT_DROP_DIR, } from "./sync.js";
export { parseNetscape, serializeNetscape, } from "./parse-netscape.js";
export { parseEditThisCookieJson } from "./parse-json.js";
export { inferProvider, inferProviderFromFilename, inferProviderFromCookies, knownProviders, } from "./infer-provider.js";
export { normalize, domainMatchesProvider, isExpired, } from "./normalize.js";
export { detectFormat, buildDetectedFile, safeBasename, safePreview, } from "./detect-format.js";
export { atomicWriteFileSync, defaultCachePathFor, } from "./atomic-write.js";
export { CookieWatcher, createWatcher, defaultDropDir, } from "./watcher.js";
//# sourceMappingURL=index.js.map