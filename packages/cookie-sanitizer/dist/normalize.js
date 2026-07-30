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
/** Returns true if the cookie's domain matches the given provider's domain scope. */
export function domainMatchesProvider(domain, provider) {
    if (!domain)
        return false;
    const d = domain.toLowerCase();
    switch (provider) {
        case "minimax":
            return d === "minimax.io" || d.endsWith(".minimax.io");
        case "anthropic":
            return d === "anthropic.com" || d.endsWith(".anthropic.com");
        case "openai":
            return (d === "openai.com" ||
                d.endsWith(".openai.com") ||
                d === "chatgpt.com" ||
                d.endsWith(".chatgpt.com"));
        case "glm":
            return (d === "z.ai" ||
                d.endsWith(".z.ai") ||
                d === "zhipuai.cn" ||
                d.endsWith(".zhipuai.cn"));
        case "openrouter":
            return d === "openrouter.ai" || d.endsWith(".openrouter.ai");
        default:
            // Unknown provider — accept all and let downstream reject.
            return true;
    }
}
/** Returns true if the cookie is expired (in the past). Session cookies never expire. */
export function isExpired(cookie, nowSec = Math.floor(Date.now() / 1000)) {
    if (cookie.expires == null)
        return false; // session cookie
    if (cookie.expires <= 0)
        return false; // 0 = session in Netscape
    return cookie.expires < nowSec;
}
/**
 * Normalize the union of all parsed cookies.
 *
 * @param cookies     Raw cookies from all parsed files
 * @param provider    Inferred (or hinted) provider; used for domain filtering and tagging
 * @param nowSec      Override for the current Unix seconds (test seam)
 */
export function normalize(cookies, provider, nowSec = Math.floor(Date.now() / 1000)) {
    if (!Array.isArray(cookies) || cookies.length === 0)
        return [];
    const dedup = new Map();
    for (const c of cookies) {
        // Rule 1: empty fields.
        if (!c.name || !c.value)
            continue;
        // Rule 2: domain must match provider (skip for unknown provider).
        if (provider && !domainMatchesProvider(c.domain, provider))
            continue;
        // Rule 3: expired.
        if (isExpired(c, nowSec))
            continue;
        // Rule 4 + 5: dedupe by (domain, name); last wins. Tag with provider.
        const key = `${c.domain}::${c.name}`;
        dedup.set(key, { ...c, provider });
    }
    return Array.from(dedup.values());
}
//# sourceMappingURL=normalize.js.map