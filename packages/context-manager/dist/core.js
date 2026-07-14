/**
 * Context Manager Core — pressure estimation, TTL, prioritization (RFC-0010)
 */
export const DEFAULT_POLICY = {
    warningThreshold: 0.6,
    compactThreshold: 0.7,
    hardStopThreshold: 0.85,
};
/** Estimate context pressure as a ratio (0-1). */
export function estimatePressure(currentTokens, maxTokens) {
    if (maxTokens <= 0)
        return 1;
    return Math.min(currentTokens / maxTokens, 1);
}
/** Determine pressure level from a ratio. */
export function getPressureLevel(pressure, policy = DEFAULT_POLICY) {
    if (pressure >= policy.hardStopThreshold)
        return "hard_stop";
    if (pressure >= policy.compactThreshold)
        return "compact";
    if (pressure >= policy.warningThreshold)
        return "warning";
    return "normal";
}
/** Create a new session-scoped context bucket. */
export function createSessionScope(id) {
    return { id, items: [], ttlMs: 30 * 60 * 1000, createdAt: Date.now() };
}
/** Set TTL on a scope (in milliseconds). */
export function setTTL(scope, ttlMs) {
    return { ...scope, ttlMs };
}
/** Add an item to a session scope. */
export function addToScope(scope, item) {
    return { ...scope, items: [...scope.items, item] };
}
/** Remove expired items from a scope based on TTL. */
export function evictExpired(scope) {
    const now = Date.now();
    return {
        ...scope,
        items: scope.items.filter((item) => {
            if (!item.expiresAt)
                return true;
            return item.expiresAt > now;
        }),
    };
}
/** Prioritize items: lower priority number = higher importance. */
export function prioritize(items, limit) {
    const sorted = [...items].sort((a, b) => a.priority - b.priority);
    return limit ? sorted.slice(0, limit) : sorted;
}
/** Count tokens using a simple word-based estimator (4 chars/token). */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
/** Calculate total tokens in a list of items. */
export function calculateTotalTokens(items) {
    return items.reduce((sum, item) => sum + item.tokens, 0);
}
//# sourceMappingURL=core.js.map