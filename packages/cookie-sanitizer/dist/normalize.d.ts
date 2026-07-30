/**
 * Normalize step — dedupe, drop invalid/expired, set provider.
 *
 * Rules (applied in order):
 *  1. Drop cookies with empty `name` or `value`.
 *  2. Drop cookies whose domain doesn't match the inferred provider.
 *  3. Drop expired cookies (expires in the past, not session).
 *  4. Dedupe by `(domain, name)` — keep the LAST entry (most recent wins).
 *  5. Mark each surviving cookie with the provider id.
 *
 * SEC-001: Cookie values are not touched here, but never logged.
 */
import type { CanonicalCookie, ProviderId } from "./types.js";
/** Returns true if the cookie's domain matches the given provider's domain scope. */
export declare function domainMatchesProvider(domain: string, provider: ProviderId): boolean;
/** Returns true if the cookie is expired (in the past). Session cookies never expire. */
export declare function isExpired(cookie: CanonicalCookie, nowSec?: number): boolean;
/**
 * Normalize the union of all parsed cookies.
 *
 * @param cookies     Raw cookies from all parsed files
 * @param provider    Inferred (or hinted) provider; used for domain filtering and tagging
 * @param nowSec      Override for the current Unix seconds (test seam)
 */
export declare function normalize(cookies: CanonicalCookie[], provider: ProviderId, nowSec?: number): CanonicalCookie[];
//# sourceMappingURL=normalize.d.ts.map