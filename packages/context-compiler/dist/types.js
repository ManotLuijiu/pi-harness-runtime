/**
 * Context Compiler - Types
 *
 * Type definitions for context compilation pipeline.
 * Every selected item has a source reference; every omitted item has a reason.
 */
export const DEFAULT_SCORING_WEIGHTS = {
    priority: 10,
    directFileReference: 5,
    recentFailureRelevance: 3,
    dependencyRelevance: 2,
    frameworkRelevance: 2,
    stalePenalty: 1,
    duplicationPenalty: 8,
};
export const DEFAULT_POLICY = {
    deny: [
        "**/.env",
        "**/*.env*",
        "**/.env.*",
        "**/*.pem",
        "**/*.key",
        "**/credentials/**",
        "**/secrets/**",
        "**/id_rsa**",
        "**/.npmrc",
        "**/netrc",
        "**/.netrc",
        "**/galaxy.yml",
        "**/.fleet.yaml",
    ],
    allowLargeFiles: false,
    maxFileBytes: 200_000,
};
/**
 * Context compilation error.
 */
export class ContextCompileError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "ContextCompileError";
        this.code = code;
        this.details = details;
    }
}
//# sourceMappingURL=types.js.map