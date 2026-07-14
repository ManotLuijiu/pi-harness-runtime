/**
 * Learning Engine Types (RFC-0058)
 *
 * Interfaces for learning from runtime execution.
 */
// ─── Secret Detection ─────────────────────────────────────────────────────────
export const SECRET_PATTERNS = [
    /api[_-]?key/i,
    /password/i,
    /secret/i,
    /token/i,
    /bearer/i,
    /auth/i,
    /credential/i,
    /private[_-]?key/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
];
export function containsSecret(value) {
    return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}
export function redactSecrets(data) {
    const redacted = { ...data };
    for (const [key, value] of Object.entries(redacted)) {
        if (typeof value === "string" && containsSecret(key)) {
            redacted[key] = "[REDACTED]";
        }
        else if (typeof value === "object" && value !== null) {
            redacted[key] = redactSecrets(value);
        }
    }
    return redacted;
}
export function calculateConfidence(factors) {
    let confidence = 0;
    // Occurrence boost (up to +30)
    confidence += Math.min(30, factors.occurrenceCount * 5);
    // Consistent positive outcomes (up to +25)
    if (factors.occurrenceCount > 0) {
        const consistencyRatio = factors.consistentPositiveOutcomes / factors.occurrenceCount;
        confidence += consistencyRatio * 25;
    }
    // Human approval (up to +20)
    confidence += Math.min(20, factors.humanApprovalCount * 10);
    // Framework corroboration (up to +10)
    confidence += Math.min(10, factors.frameworkCorroboration * 5);
    // Penalties
    // Contradictory outcomes (-15 per)
    confidence -= Math.min(40, factors.contradictoryOutcomes * 15);
    // Single event evidence (-10)
    if (factors.singleEventEvidence) {
        confidence -= 10;
    }
    // Stale repository (-5)
    if (factors.staleRepository) {
        confidence -= 5;
    }
    // Changed project rules (-20)
    if (factors.changedProjectRules) {
        confidence -= 20;
    }
    return Math.max(0, Math.min(100, Math.round(confidence)));
}
//# sourceMappingURL=types.js.map