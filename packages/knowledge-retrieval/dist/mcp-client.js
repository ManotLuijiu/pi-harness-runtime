/**
 * TencentDB-Agent-Memory MCP Client (RFC-0105)
 *
 * Client for interacting with TencentDB-Agent-Memory server via MCP protocol.
 */
import { fetch } from "undici";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RESULTS = 5;
/**
 * MCP Client for TencentDB-Agent-Memory
 */
export class KnowledgeRetrievalClient {
    config;
    constructor(config) {
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
    async request(method, params = {}) {
        const headers = {
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
            throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json());
        if (data.error) {
            throw new Error(`MCP error: ${data.error.message}`);
        }
        return data.result;
    }
    /**
     * Search skills/knowledge via hybrid retrieval
     */
    async search(options) {
        const limit = options.limit ?? this.config.maxResults;
        const result = await this.request("tdai_memory_search", {
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
    async searchConversations(query, limit) {
        const result = await this.request("tdai_conversation_search", {
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
    async queryCodeGraph(symbol) {
        return this.request("tdai_codegraph_query", {
            symbol,
        });
    }
    /**
     * Get list of available tools from server
     */
    async listTools() {
        const result = await this.request("tools/list", {});
        return result.tools;
    }
    /**
     * Check server health
     */
    async healthCheck() {
        try {
            const response = await fetch(`${this.config.serverUrl}/health`, {
                signal: AbortSignal.timeout(2000),
            });
            if (response.ok) {
                return response.json();
            }
            return { status: "unhealthy" };
        }
        catch {
            return { status: "unreachable" };
        }
    }
}
/**
 * Create a KnowledgeRetrievalClient from URL string
 */
export function createKnowledgeClient(serverUrl, options) {
    return new KnowledgeRetrievalClient({ serverUrl, ...options });
}
//# sourceMappingURL=mcp-client.js.map