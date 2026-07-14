/**
 * Codex Adapter — Execution Sandbox (RFC-0070)
 */
import type { ExecutionResult, ExecutionConfig } from "./types.js";
/**
 * Execute code in a sandboxed environment
 */
export declare class ExecutionSandbox {
    private config;
    constructor(config?: ExecutionConfig);
    execute(command: string): Promise<ExecutionResult>;
    executeCode(code: string, language: "python" | "javascript" | "bash"): Promise<ExecutionResult>;
}
//# sourceMappingURL=executor.d.ts.map