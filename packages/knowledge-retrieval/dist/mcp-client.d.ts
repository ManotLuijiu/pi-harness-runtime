/**
 * TencentDB-Agent-Memory MCP Client (RFC-0105)
 *
 * Client for interacting with TencentDB-Agent-Memory server via MCP protocol.
 */
import type { SearchOptions, SearchResult, CodeGraphResult } from "./types.js";
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
export declare class KnowledgeRetrievalClient {
    private config;
    constructor(config: KnowledgeRetrievalConfig);
    /**
     * Make MCP request to server
     */
    private request;
    /**
     * Search skills/knowledge via hybrid retrieval
     */
    search(options: SearchOptions): Promise<SearchResult[]>;
    /**
     * Search conversations
     */
    searchConversations(query: string, limit?: number): Promise<SearchResult[]>;
    /**
     * Query code graph
     */
    queryCodeGraph(symbol: string): Promise<CodeGraphResult>;
    /**
     * Get list of available tools from server
     */
    listTools(): Promise<Array<{
        name: string;
        description: string;
    }>>;
    /**
     * Check server health
     */
    healthCheck(): Promise<{
        status: string;
        version?: string;
    }>;
}
/**
 * Create a KnowledgeRetrievalClient from URL string
 */
export declare function createKnowledgeClient(serverUrl: string, options?: Partial<Omit<KnowledgeRetrievalConfig, "serverUrl">>): KnowledgeRetrievalClient;
//# sourceMappingURL=mcp-client.d.ts.map