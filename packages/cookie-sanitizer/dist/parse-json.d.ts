/**
 * EditThisCookie / Chrome devtools JSON cookie export parser.
 *
 * Browser extension "EditThisCookie" and Chrome devtools both export
 * cookies in this canonical shape (Chrome/Edge/Chromium cookie store):
 *
 * ```json
 * [
 *   {
 *     "domain": ".minimax.io",
 *     "expirationDate": 1760000000.123,
 *     "hostOnly": false,
 *     "httpOnly": true,
 *     "name": "_token",
 *     "path": "/",
 *     "sameSite": "no_restriction",
 *     "secure": true,
 *     "session": false,
 *     "storeId": "0",
 *     "value": "...",
 *     "id": 1
 *   }
 * ]
 * ```
 *
 * Some tools may export a single object (not an array). Handle both.
 *
 * SEC-001: Cookie VALUES are returned as strings in-memory. Never logged.
 */
import type { CanonicalCookie } from "./types.js";
/**
 * Parse EditThisCookie / Chrome devtools JSON export.
 *
 * Accepts:
 * - top-level array of records
 * - top-level single object
 *
 * Skips:
 * - non-object entries
 * - records without non-empty name+value
 *
 * Never throws; returns empty array on parse failure.
 */
export declare function parseEditThisCookieJson(text: string): CanonicalCookie[];
//# sourceMappingURL=parse-json.d.ts.map