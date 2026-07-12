/**
 * Project Analyzer Types
 *
 * Type definitions for project analysis output and plugin interface.
 */
// ─── SDK Version ───────────────────────────────────────────────────────
export const SDK_VERSION = "1.0.0";
export const DEFAULT_ANALYZER_CONFIG = {
    maxScanFiles: 10000,
    maxFileSize: 200000,
    maxDepth: 20,
    sensitivePatterns: [
        ".env",
        ".env.*",
        "*.pem",
        "credentials/**",
        "secrets/**",
        "private/**",
        "*.key",
        "*.p12",
        "*.pfx",
    ],
    generatedPatterns: [
        "node_modules/**",
        "dist/**",
        "build/**",
        "coverage/**",
        "__pycache__/**",
        ".pytest_cache/**",
        ".next/**",
        ".nuxt/**",
        ".output/**",
    ],
    ruleFileNames: [
        "AGENTS.md",
        "RULES.md",
        "PROJECT_RULES.md",
        "CONTRIBUTING.md",
        ".claude.md",
        "CLAUDE.md",
    ],
    detectMonorepo: true,
};
//# sourceMappingURL=types.js.map