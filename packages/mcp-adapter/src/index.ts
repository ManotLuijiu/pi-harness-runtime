/**
 * MCP Adapter — Main Entry (RFC-0068)
 */

export { createMCPServer } from "./server.js";
export type {
	MCPRequest,
	MCPResponse,
	MCPError,
	MCPServerOptions,
	ServerCapabilities,
	InitializeResult,
	MCPTool,
	MCPToolCall,
	MCPResource,
	MCPPrompt,
	ToolCallResult,
} from "./types.js";
export { HARNESS_TOOLS } from "./tools.js";
export { handleToolCall } from "./tools.js";
