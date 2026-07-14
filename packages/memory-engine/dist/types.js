/**
 * Memory Engine Types (RFC-0060)
 *
 * Interfaces for OKF-based knowledge management.
 */
// ─── Reserved Files ───────────────────────────────────────────────────────────
export const RESERVED_FILES = ["index.md", "log.md"];
export function isReservedFile(filename) {
    return RESERVED_FILES.includes(filename);
}
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
export function filterSecrets(content) {
    return content.replace(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]+)/g, (match, key) => {
        if (containsSecret(key)) {
            return `${key}=[REDACTED]`;
        }
        return match;
    });
}
export const AUTHORITY_PRIORITY = {
    approved: 3,
    generated: 2,
    unverified: 1,
};
//# sourceMappingURL=types.js.map