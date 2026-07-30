/**
 * Cookie sanitizer types.
 *
 * The data model is intentionally simple and explicit. Cookies flow in
 * from one of two input formats (Netscape, EditThisCookie JSON), are
 * normalised here into a canonical record, and written out as a single
 * standard Netscape file by the writer.
 *
 * Cookie values are NEVER logged anywhere. They live in memory only
 * for the duration of one parse → normalize → write cycle.
 */
/** Provider identifier — inferred from filename or dominant cookie domain. */
export type ProviderId = "minimax" | "anthropic" | "openai" | "glm" | "openrouter" | string;
/** Input file format. */
export type CookieFileFormat = "netscape" | "edit-this-cookie-json";
/** A single cookie in canonical (post-normalize) form. */
export interface CanonicalCookie {
    /** Provider this cookie belongs to. Set during infer-provider pass. */
    provider?: ProviderId;
    /** Cookie name (e.g. "_token", "_ga"). Must be non-empty after normalization. */
    name: string;
    /** Cookie value. NEVER logged. */
    value: string;
    /** Cookie domain (e.g. ".minimax.io", "platform.minimax.io"). */
    domain: string;
    /** URL path this cookie applies to (default "/"). */
    path: string;
    /** Expires at — Unix seconds since epoch. NaN or undefined = session cookie. */
    expires?: number;
    /** Whether this is a Secure-only cookie (HTTPS-only). */
    secure: boolean;
    /** Whether this cookie is HTTP-only (no JS access). */
    httpOnly: boolean;
}
/** Result of detecting a single file's format. */
export interface DetectedFile {
    /** Absolute path (or relative, in tests). */
    path: string;
    /** Filename only (no directory). Used for log lines — never the full path contents. */
    basename: string;
    /** Detected format. */
    format: CookieFileFormat | null;
    /** Raw text content (truncated to first 4096 chars for safety in debug logs). */
    text: string;
    /** Parse error if format is null. Null error means format is unknown. */
    error?: string;
}
/** Sync result for the whole drop folder. */
export interface SyncResult {
    /** Provider that was inferred. Null if inference failed. */
    provider: ProviderId | null;
    /** Files considered (readable, recognized format). */
    processedFiles: string[];
    /** Files skipped (unreadable, unknown format). */
    skippedFiles: Array<{
        basename: string;
        reason: string;
    }>;
    /** Total cookies after dedupe across all files. */
    totalCookies: number;
    /** Path the canonical cache was written to (relative or absolute). */
    cachePath: string;
    /** Source path the cookies came from. */
    sourceDir: string;
    /** True if the cache was actually written (no-op if no new data). */
    wrote: boolean;
    /** Errors during sync (per-file, never value-bearing). */
    errors: Array<{
        basename: string;
        message: string;
    }>;
}
/** Sync options. */
export interface SyncOptions {
    /** Override the default drop-folder location. */
    dropDir?: string;
    /** Override the default canonical cache location. */
    cachePath?: string;
    /** Provider hint (skips filename/domain inference). */
    providerHint?: ProviderId;
    /** Skip writing the cache file even if normalization produced cookies. */
    dryRun?: boolean;
}
/** Watcher events emitted by the live watcher. */
export type WatcherEvent = {
    kind: "sync-ok";
    provider: ProviderId;
    cachePath: string;
    cookies: number;
} | {
    kind: "sync-skip";
    reason: string;
} | {
    kind: "sync-error";
    message: string;
} | {
    kind: "watcher-error";
    message: string;
};
//# sourceMappingURL=types.d.ts.map