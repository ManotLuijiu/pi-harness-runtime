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
export function parseEditThisCookieJson(text) {
    if (typeof text !== "string" || text.length === 0)
        return [];
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        return [];
    }
    const records = [];
    if (Array.isArray(data)) {
        for (const item of data) {
            if (item && typeof item === "object" && !Array.isArray(item)) {
                records.push(item);
            }
        }
    }
    else if (data && typeof data === "object" && !Array.isArray(data)) {
        records.push(data);
    }
    const cookies = [];
    for (const r of records) {
        const name = asString(r.name);
        const value = asString(r.value);
        if (!name || !value)
            continue;
        const expires = asExpires(r.expirationDate, r.session);
        cookies.push({
            name,
            value,
            domain: asString(r.domain) ?? "",
            path: asString(r.path) ?? "/",
            expires,
            secure: asBool(r.secure) ?? false,
            httpOnly: asBool(r.httpOnly) ?? false,
        });
    }
    return cookies;
}
function asString(v) {
    if (typeof v === "string" && v.length > 0)
        return v;
    return undefined;
}
function asBool(v) {
    if (typeof v === "boolean")
        return v;
    if (v === 1 || v === "1" || v === "true" || v === "TRUE")
        return true;
    if (v === 0 || v === "0" || v === "false" || v === "FALSE")
        return false;
    return undefined;
}
function asExpires(v, session) {
    if (session === true || session === "true")
        return undefined;
    if (typeof v === "number" && Number.isFinite(v)) {
        // EditThisCookie uses unix-seconds (with millisecond decimals sometimes).
        // If v > 1e12, it's milliseconds — convert.
        const seconds = v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
        return seconds > 0 ? seconds : undefined;
    }
    return undefined;
}
//# sourceMappingURL=parse-json.js.map