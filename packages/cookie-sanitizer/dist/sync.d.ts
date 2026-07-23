/**
 * Sync orchestrator — the heart of the sanitizer.
 *
 * Pipeline (per run):
 *   1. Enumerate files in the drop folder (one level + one sublevel).
 *   2. Read each file. Detect format. Parse.
 *   3. Concatenate cookies from all parsed files.
 *   4. Infer provider from filename + cookies.
 *   5. Normalize (dedupe, expire, domain-match).
 *   6. Serialize to Netscape and write to the canonical cache (atomic).
 *
 * Returns a SyncResult. Never throws — returns structured errors in `result.errors`.
 *
 * Sec-001: Cookie VALUES never appear in any log line. Diagnostics
 * use file basenames and 64-char previews with values redacted.
 */
import type { SyncOptions, SyncResult } from "./types.js";
/** Default drop-folder location. */
export declare const DEFAULT_DROP_DIR: string;
/**
 * Enumerate readable files inside `dir`, up to MAX_DEPTH.
 * Returns absolute paths. Skips dotfiles, editor temp files.
 *
 * `excludePath` (optional) — absolute path of a file to skip, e.g.
 * the canonical cache file (so we never recursively read it).
 */
export declare function enumerateDropFiles(dir: string, excludePath?: string): string[];
/**
 * Read a single input file as text, capped at MAX_INPUT_BYTES.
 * Returns null + a `reason` if the file can't be read.
 */
export declare function readInputFile(filePath: string): {
    text: string;
    reason?: string;
};
/**
 * Run the full sync pipeline.
 *
 * Options:
 *   - dropDir      default: ~/.pi-harness-runtime/cookies/
 *   - cachePath    default: ~/.config/<provider>-cookies.txt
 *   - providerHint override inference (skips filename/domain checks)
 *   - dryRun       skip the actual file write (still returns would-be result)
 *
 * Returns a SyncResult. Never throws.
 */
export declare function sync(opts?: SyncOptions): SyncResult;
/**
 * Has-any-input check: true if the drop folder has anything readable.
 * Cheap — does a single `readdirSync`; no parsing.
 */
export declare function hasAnyCookieSource(dropDir?: string): boolean;
/**
 * Convenience: cache path for the dominant provider in the drop folder,
 * or null if nothing's there. Used by `footer-status.ts` to ask "should
 * the footer hint point at this provider?"
 */
export declare function inferCachePath(dropDir?: string): string | null;
export { inferProvider, inferProviderFromFilename, inferProviderFromCookies, } from "./infer-provider.js";
export { defaultCachePathFor } from "./atomic-write.js";
export type { SyncOptions, SyncResult, CanonicalCookie, ProviderId, DetectedFile, CookieFileFormat, WatcherEvent, } from "./types.js";
//# sourceMappingURL=sync.d.ts.map