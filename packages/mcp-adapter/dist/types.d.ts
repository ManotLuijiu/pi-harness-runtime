/**
 * MCP Adapter — Types (RFC-0068)
 */
export interface MCPRequest {
    jsonrpc: "2.0";
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
}
export interface MCPResponse {
    jsonrpc: "2.0";
    id: number | string;
    result?: unknown;
    error?: MCPError;
}
export interface MCPError {
    code: number;
    message: string;
    data?: unknown;
}
export interface MCPServerOptions {
    name?: string;
    version?: string;
}
export interface ServerCapabilities {
    tools?: {
        listChanged?: boolean;
    };
    resources?: {
        subscribe?: boolean;
        listChanged?: boolean;
    };
    prompts?: {
        listChanged?: boolean;
    };
}
export interface InitializeResult {
    protocolVersion: "2024-11-05";
    capabilities: ServerCapabilities;
    serverInfo: {
        name: string;
        version: string;
    };
}
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}
export interface MCPToolCall {
    name: string;
    arguments?: Record<string, unknown>;
}
export interface ToolCallParams {
    name: string;
    arguments?: Record<string, unknown>;
}
export interface ToolCallResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
}
export interface MCPResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}
export interface MCPPrompt {
    name: string;
    description?: string;
    arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}
//# sourceMappingURL=types.d.ts.map