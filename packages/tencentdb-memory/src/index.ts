/**
 * TencentDB Memory (RFC-0105)
 *
 * Client for TencentDB-Agent-Memory server.
 * Syncs skills and provides MCP tools for centralized knowledge retrieval.
 */

export type {
	TencentDBConfig,
	SkillMetadata,
	SyncRequest,
	SyncResponse,
	SearchRequest,
	SearchResult,
	DeleteRequest,
	HealthResponse,
} from "./types.js";

export { TencentDBMemoryClient, createTencentDBClient } from "./client.js";
export {
	loadSkill,
	loadSkillsFromDirectory,
	loadSkillsFromDirectories,
} from "./loader.js";

export type {
	MCPTool,
	MCPToolCall,
	ToolCallResult,
} from "./types.js";

export { getTencentDBTools, TencentDBToolHandler } from "./mcp-tools.js";
