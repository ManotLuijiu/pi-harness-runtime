/**
 * Provider inference — figure out which provider a cookie dump belongs to
 * without the user having to organize by subfolder.
 *
 * Three inference passes, first hit wins:
 *   1. Filename hint    (e.g. `minimax-*.txt`, `*minimax.json` → "minimax")
 *   2. Dominant domain  (≥ 80% of cookies on `*.minimax.io` → "minimax")
 *   3. Nothing           → null (caller will surface a friendly error)
 *
 * Provider hint from SyncOptions overrides all of the above.
 */
import type { CanonicalCookie, ProviderId } from "./types.js";
/** Returns the first provider whose filename pattern matches, or null. */
export declare function inferProviderFromFilename(filename: string): ProviderId | null;
/** Returns the provider whose domain is the dominant (≥ 80%) match. */
export declare function inferProviderFromCookies(cookies: CanonicalCookie[]): ProviderId | null;
/**
 * Combined inference: hint → filename → dominant domain → null.
 *
 * If `filename` is provided it takes priority over domain inference
 * (filename hints are explicit). Domain inference is the fallback.
 */
export declare function inferProvider(filename: string | undefined, cookies: CanonicalCookie[], hint?: ProviderId): ProviderId | null;
/**
 * Build a list of provider rules used by other parts of the package.
 * Exposed for UI display (e.g. "which providers does this sanitizer know?").
 */
export declare function knownProviders(): ProviderId[];
//# sourceMappingURL=infer-provider.d.ts.map