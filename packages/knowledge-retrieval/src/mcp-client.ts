/**
 * TencentDB-Agent-Memory MCP Client (RFC-0105)
 *
 * Client for interacting with TencentDB-Agent-Memory server via MCP protocol.
 */

import { fetch } from "undici";
import type {
  SearchOptions,
  SearchResult,
  CodeGraphResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RESULTS = 5;

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
 * MCP Client for TencentDB-Agent-Memory
 */
export class KnowledgeRetrievalClient {
  private config: Required<KnowledgeRetrievalConfig>;

  constructor(config: KnowledgeRetrievalConfig) {
    this.config = {
      serverUrl: config.serverUrl.replace(/\/$/, ""),
      apiKey: config.apiKey ?? "",
      maxResults: config.maxResults ?? DEFAULT_MAX_RESULTS,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /**
   * Make MCP request to server
   */
  private async request<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${this.config.serverUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `MCP request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };

    if (data.error) {
      throw new Error(`MCP error: ${data.error.message}`);
    }

    return data.result as T;
  }

  /**
   * Search skills/knowledge via hybrid retrieval
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    const limit = options.limit ?? this.config.maxResults;

    const result = await this.request<{
      results: Array<{
        id: string;
        title: string;
        content: string;
        score: number;
        source: string;
        tags: string[];
        links: string[];
        updatedAt: string;
      }>;
    }>("tdai_memory_search", {
      query: options.query,
      limit,
      ...(options.tags && { tags: options.tags }),
      ...(options.source && { source: options.source }),
    });

    return result.results.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      score: r.score,
      source: r.source,
      tags: r.tags,
      links: r.links,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Search conversations
   */
  async searchConversations(
    query: string,
    limit?: number,
  ): Promise<SearchResult[]> {
    const result = await this.request<{
      results: Array<{
        id: string;
        title: string;
        content: string;
        score: number;
        source: string;
        tags: string[];
        links: string[];
        updatedAt: string;
      }>;
    }>("tdai_conversation_search", {
      query,
      limit: limit ?? this.config.maxResults,
    });

    return result.results.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      score: r.score,
      source: r.source,
      tags: r.tags,
      links: r.links,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Query code graph
   */
  async queryCodeGraph(symbol: string): Promise<CodeGraphResult> {
    return this.request<CodeGraphResult>("tdai_codegraph_query", {
      symbol,
    });
  }

  /**
   * Get list of available tools from server
   */
  async listTools(): Promise<
    Array<{ name: string; description: string }>
  > {
    const result = await this.request<{
      tools: Array<{ name: string; description: string }>;
    }>("tools/list", {});

    return result.tools;
  }

  /**
   * Check server health
   */
  async healthCheck(): Promise<{ status: string; version?: string }> {
    try {
      const response = await fetch(`${this.config.serverUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        return response.json() as Promise<{ status: string; version?: string }>;
      }

      return { status: "unhealthy" };
    } catch {
      return { status: "unreachable" };
    }
  }
}

/**
 * Create a KnowledgeRetrievalClient from URL string
 */
export function createKnowledgeClient(
  serverUrl: string,
  options?: Partial<Omit<KnowledgeRetrievalConfig, "serverUrl">>,
): KnowledgeRetrievalClient {
  return new KnowledgeRetrievalClient({ serverUrl, ...options });
}
