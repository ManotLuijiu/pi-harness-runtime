/**
 * MCP Adapter — STDIO Server (RFC-0068)
 *
 * Implements MCP Protocol 2024-11-05 over STDIO.
 * Reads JSON-RPC requests from stdin, writes responses to stdout.
 */
import type { MCPServerOptions } from "./types.js";
export declare function createMCPServer(options?: MCPServerOptions): Promise<void>;
//# sourceMappingURL=server.d.ts.map