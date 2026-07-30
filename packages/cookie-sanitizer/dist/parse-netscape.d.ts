/**
 * Netscape-format cookie file parser.
 *
 * Format reference: https://curl.haxx.se/rfc/cookie_spec.html
 *
 * Each row is tab-separated, 7 columns:
 *   domain  flag  path  secure  expires  name  value
 *
 * - Lines starting with `# ` are comments (skipped).
 * - Lines starting with `#HttpOnly_` are HTTP-only cookies
 *   (the leading `#HttpOnly_` is stripped, the rest is parsed normally).
 * - Empty lines are skipped.
 * - `expires` is Unix seconds; `0` or unparseable → session cookie.
 * - Lines with fewer than 7 columns are skipped (malformed).
 *
 * SEC-001: Cookie values are returned as strings in-memory. They MUST
 * never be logged. The scrubber in cookie-sanitizer applies value
 * redaction before any path-touching log line.
 */
import type { CanonicalCookie } from "./types.js";
/**
 * Parse a Netscape-format cookie string into canonical records.
 *
 * Skips:
 * - blank lines
 * - comments (lines starting with `#` but not `#HttpOnly_`)
 * - malformed rows (< 7 columns)
 *
 * Never throws; returns empty array if input is invalid.
 */
export declare function parseNetscape(text: string): CanonicalCookie[];
/**
 * Serialize a list of canonical cookies back to Netscape format.
 * Used by atomic-write.ts to produce the canonical cache.
 *
 * Output uses the canonical column order:
 *   domain  flag  path  secure  expires  name  value
 *
 * `flag` is FALSE per curl spec (HttpOnly is encoded as `#HttpOnly_`).
 * Cookie values are NEVER logged during the round-trip.
 */
export declare function serializeNetscape(cookies: CanonicalCookie[]): string;
//# sourceMappingURL=parse-netscape.d.ts.map