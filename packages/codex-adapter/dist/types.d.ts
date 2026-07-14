/**
 * Codex Adapter — Types (RFC-0070)
 */
export type CodexModel = "gpt-4o" | "o3" | "o4-mini";
export interface CodexConfig {
    apiKey: string;
    model?: CodexModel;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
}
export interface CodexOptions {
    model?: CodexModel;
    maxTokens?: number;
    temperature?: number;
    tools?: CodexTool[];
    toolChoice?: "auto" | "none";
}
export interface CodexTool {
    type: "function";
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}
export interface CodexResponse {
    content: string;
    finishReason: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
    };
}
export interface ExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
}
export interface ExecutionConfig {
    timeout?: number;
    memoryLimitMB?: number;
    cwd?: string;
    env?: Record<string, string>;
}
export declare const DEFAULT_TOOLS: CodexTool[];
//# sourceMappingURL=types.d.ts.map