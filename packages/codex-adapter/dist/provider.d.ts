/**
 * Codex Adapter — Provider (RFC-0070)
 */
import type { CodexConfig, CodexOptions, CodexResponse } from "./types.js";
import { DEFAULT_TOOLS } from "./types.js";
export { DEFAULT_TOOLS };
/**
 * OpenAI Codex Provider for pi-harness
 */
export declare class CodexProvider {
    readonly id = "codex";
    readonly name = "OpenAI Codex";
    readonly provider: {
        complete: (prompt: string, options?: unknown) => Promise<CodexResponse>;
        stream: undefined;
        embed: undefined;
    };
    private apiKey;
    private cfg;
    constructor(config: CodexConfig);
    complete(prompt: string, options?: CodexOptions): Promise<CodexResponse>;
    stream(prompt: string, options?: CodexOptions): AsyncGenerator<string>;
    healthCheck(): Promise<boolean>;
    estimateCost(inputTokens: number, outputTokens: number): number;
}
//# sourceMappingURL=provider.d.ts.map