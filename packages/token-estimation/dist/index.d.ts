/**
 * Token Estimation
 *
 * Rough token counting for messages and text.
 * Used for context window management before API calls.
 */
/**
 * Rough token count estimation — conservative (overestimates slightly).
 * Based on average ~3.8 chars/token for English text.
 */
export declare function roughTokenCount(text: string): number;
/**
 * Rough token count for a structured message.
 * Handles role, content, tool_calls, tool_results, thinking blocks.
 */
export declare function roughMessageTokens(msg: {
    role?: string;
    content?: string | {
        type: string;
        text?: string;
        name?: string;
        input?: unknown;
        thinking?: string;
    }[] | null;
    tool_calls?: {
        id: string;
        name: string;
        input: unknown;
    }[];
    thinking?: string;
}): number;
/**
 * Rough token count for a full message array (API request format).
 */
export declare function roughMessagesTokens(messages: Array<{
    role?: string;
    content?: string | {
        type: string;
        text?: string;
        name?: string;
        input?: unknown;
        thinking?: string;
    }[] | null;
    tool_calls?: {
        id: string;
        name: string;
        input: unknown;
    }[];
    thinking?: string;
}>): number;
/**
 * Estimate tokens for a system prompt string.
 * System prompts typically have overhead from role markers.
 */
export declare function roughSystemPromptTokens(systemPrompt: string): number;
/**
 * Estimate tokens for tool definitions (schema).
 */
export declare function roughToolDefinitionTokens(tool: {
    name: string;
    description?: string;
    input_schema?: Record<string, unknown>;
}): number;
/**
 * Estimate total request tokens (input to API).
 */
export interface RequestTokenEstimate {
    systemPrompt: number;
    messages: number;
    tools: number;
    total: number;
    maxOutputTokens: number;
    availableForContext: number;
}
export declare function estimateRequestTokens(systemPrompt: string, messages: Array<{
    role?: string;
    content?: string | {
        type: string;
        text?: string;
        name?: string;
        input?: unknown;
        thinking?: string;
    }[] | null;
    tool_calls?: {
        id: string;
        name: string;
        input: unknown;
    }[];
}>, tools: Array<{
    name: string;
    description?: string;
    input_schema?: Record<string, unknown>;
}>, maxOutputTokens: number): RequestTokenEstimate;
//# sourceMappingURL=index.d.ts.map