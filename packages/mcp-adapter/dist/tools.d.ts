/**
 * MCP Adapter — Tool Definitions (RFC-0068)
 *
 * Exposes 4 core harness capabilities as MCP tools.
 */
import type { MCPTool, ToolCallResult } from "./types.js";
export declare const HARNESS_TOOLS: MCPTool[];
/**
 * Tool handler function — maps MCP tool name to harness capability
 */
export declare function handleToolCall(toolName: string, args?: Record<string, unknown>): Promise<ToolCallResult>;
//# sourceMappingURL=tools.d.ts.map