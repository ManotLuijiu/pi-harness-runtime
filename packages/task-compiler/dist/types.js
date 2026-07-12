/**
 * Task Compiler - Type Definitions
 *
 * Core types for task decomposition, DAG construction, and verification.
 */
// ─── SDK Version ───────────────────────────────────────────────────────
export const SDK_VERSION = "1.0.0";
// ─── Standard Engineering Flow ────────────────────────────────────────
export const STANDARD_FLOW = [
    "analysis",
    "design",
    "implementation",
    "test",
    "e2e_test",
    "review",
    "repair",
    "documentation",
];
// ─── Provider Hints ───────────────────────────────────────────────────
export const PROVIDER_HINTS = {
    analysis: ["codex", "gpt", "glm"],
    design: ["codex", "gpt", "glm"],
    implementation: ["minimax", "claude", "glm"],
    test: ["minimax", "claude"],
    e2e_test: ["playwright"],
    review: ["claude", "glm"],
    repair: ["glm", "claude"],
    documentation: ["codex", "gpt"],
};
// ─── Default Command Policy ─────────────────────────────────────────────
export const PROHIBITED_BY_DEFAULT = [
    "git commit",
    "git push",
    "bench build",
    "bench migrate",
    "bench install-app",
    "bench restart",
    "npm run build",
    "yarn build",
    "pnpm build",
    "python manage.py migrate",
    "docker compose up",
    "docker compose down",
    "rm -rf",
    "DROP DATABASE",
    "TRUNCATE",
];
export const DEFAULT_TASK_COMPILER_CONFIG = {
    insertE2E: true,
    maxComplexity: 5,
    extraProhibitedCommands: [],
    clock: () => new Date(),
};
// ─── Compiler Errors ─────────────────────────────────────────────────────
export var TaskCompilerErrorCode;
(function (TaskCompilerErrorCode) {
    TaskCompilerErrorCode["CYCLIC_DEPENDENCY"] = "CYCLIC_DEPENDENCY";
    TaskCompilerErrorCode["EMPTY_OBJECTIVE"] = "EMPTY_OBJECTIVE";
    TaskCompilerErrorCode["NO_VERIFICATION"] = "NO_VERIFICATION";
    TaskCompilerErrorCode["FILE_OVERLAP_CONFLICT"] = "FILE_OVERLAP_CONFLICT";
    TaskCompilerErrorCode["UNSATISFIED_CRITERION"] = "UNSATISFIED_CRITERION";
    TaskCompilerErrorCode["MISSING_CAPABILITY"] = "MISSING_CAPILITY";
    TaskCompilerErrorCode["DESTRUCTIVE_COMMAND_APPROVAL"] = "DESTRUCTIVE_COMMAND_APPROVAL";
})(TaskCompilerErrorCode || (TaskCompilerErrorCode = {}));
export class TaskCompilerError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "TaskCompilerError";
        this.code = code;
        this.details = details;
    }
}
//# sourceMappingURL=types.js.map