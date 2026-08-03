/**
 * Knowledge Retrieval Types (RFC-0105)
 *
 * Types for TencentDB-Agent-Memory MCP integration.
 */

/**
 * Configuration for TencentDB-Agent-Memory server connection
 */
export interface KnowledgeRetrievalConfig {
  /** Server URL (e.g., http://localhost:8080 or https://memory.example.com) */
  serverUrl: string;
  /** Optional API key for authentication */
  apiKey?: string;
  /** Default max results per search */
  maxResults?: number;
  /** Request timeout in ms */
  timeoutMs?: number;
}

/**
 * Search query options
 */
export interface SearchOptions {
  /** Search query string */
  query: string;
  /** Max results to return (default: 5) */
  limit?: number;
  /** Filter by tags */
  tags?: string[];
  /** Filter by source path */
  source?: string;
}

/**
 * Search result item
 */
export interface SearchResult {
  /** Unique result ID */
  id: string;
  /** Document title */
  title: string;
  /** Document content/summary */
  content: string;
  /** Relevance score (0-1) */
  score: number;
  /** Original source path */
  source: string;
  /** Document tags */
  tags: string[];
  /** Links to other OKF documents */
  links: string[];
  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Code graph query result
 */
export interface CodeGraphResult {
  /** Symbol/function name */
  symbol: string;
  /** File path */
  file: string;
  /** Symbol type (function, class, etc.) */
  kind: string;
  /** Callers of this symbol */
  callers: string[];
  /** Callees of this symbol */
  callees: string[];
  /** Impact paths */
  impactPaths: string[];
}

/**
 * Sync result
 */
export interface SyncResult {
  /** Total skills processed */
  total: number;
  /** Successfully synced */
  success: number;
  /** Failed syncs */
  failed: number;
  /** Errors if any */
  errors: string[];
}

/**
 * OKF document format for ingestion
 */
export interface OKFDocument {
  id: string;
  title: string;
  sections: OKFSection[];
  links: string[];
  metadata: OKFMetadata;
}

export interface OKFSection {
  id: string;
  title: string;
  content: string;
  level: number;
}

export interface OKFMetadata {
  source: string;
  tags: string[];
  created: string;
  updated: string;
}
