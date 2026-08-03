/**
 * Knowledge Retrieval (RFC-0105)
 *
 * Centralized knowledge retrieval via TencentDB-Agent-Memory MCP.
 */

export {
  KnowledgeRetrievalClient,
  createKnowledgeClient,
  type KnowledgeRetrievalConfig,
} from "./mcp-client.js";
export type {
  SearchOptions,
  SearchResult,
  CodeGraphResult,
  SyncResult,
  OKFDocument,
} from "./types.js";
