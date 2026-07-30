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
const FILENAME_HINTS = [
    { pattern: /minimax/i, provider: "minimax" },
    { pattern: /anthropic|claude/i, provider: "anthropic" },
    { pattern: /openai|gpt|chatgpt/i, provider: "openai" },
    { pattern: /glm|z\.ai|zhipuai/i, provider: "glm" },
    { pattern: /openrouter/i, provider: "openrouter" },
];
const DOMAIN_HINTS = [
    { pattern: /\.minimax\.io$|^minimax\.io$/i, provider: "minimax" },
    { pattern: /\.anthropic\.com$|^anthropic\.com$/i, provider: "anthropic" },
    {
        pattern: /\.openai\.com$|^openai\.com$|\.chatgpt\.com$|^chatgpt\.com$/i,
        provider: "openai",
    },
    {
        pattern: /\.z\.ai$|^z\.ai$|\.zhipuai\.cn$|^zhipuai\.cn$/i,
        provider: "glm",
    },
    { pattern: /\.openrouter\.ai$|^openrouter\.ai$/i, provider: "openrouter" },
];
/** Returns the first provider whose filename pattern matches, or null. */
export function inferProviderFromFilename(filename) {
    if (!filename)
        return null;
    for (const { pattern, provider } of FILENAME_HINTS) {
        if (pattern.test(filename))
            return provider;
    }
    return null;
}
/** Returns the provider whose domain is the dominant (≥ 80%) match. */
export function inferProviderFromCookies(cookies) {
    if (!Array.isArray(cookies) || cookies.length === 0)
        return null;
    const counts = new Map();
    let total = 0;
    for (const c of cookies) {
        if (!c.domain)
            continue;
        total += 1;
        for (const { pattern, provider } of DOMAIN_HINTS) {
            if (pattern.test(c.domain.toLowerCase())) {
                counts.set(provider, (counts.get(provider) ?? 0) + 1);
                break;
            }
        }
    }
    if (total === 0)
        return null;
    const threshold = Math.ceil(total * 0.8); // ≥ 80 %
    let best = null;
    for (const [provider, count] of counts) {
        if (count >= threshold && (!best || count > best.count)) {
            best = { provider, count };
        }
    }
    return best?.provider ?? null;
}
/**
 * Combined inference: hint → filename → dominant domain → null.
 *
 * If `filename` is provided it takes priority over domain inference
 * (filename hints are explicit). Domain inference is the fallback.
 */
export function inferProvider(filename, cookies, hint) {
    if (hint)
        return hint;
    if (filename) {
        const fromName = inferProviderFromFilename(filename);
        if (fromName)
            return fromName;
    }
    return inferProviderFromCookies(cookies);
}
/**
 * Build a list of provider rules used by other parts of the package.
 * Exposed for UI display (e.g. "which providers does this sanitizer know?").
 */
export function knownProviders() {
    const set = new Set();
    for (const { provider } of FILENAME_HINTS)
        set.add(provider);
    return Array.from(set);
}
//# sourceMappingURL=infer-provider.js.map