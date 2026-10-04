/**
 * TencentDB Knowledge Service Client (RFC-0105/0106)
 *
 * Client for TencentDB-Agent-Memory Knowledge Service
 * Base URL: https://your-memory-server.example.com/v3/
 */
/**
 * TencentDB Knowledge Service API Client
 */
export class TencentDBClient {
    baseUrl;
    userKey;
    serviceId;
    constructor(options) {
        // Remove trailing slash and ensure /v3/ path
        this.baseUrl = options.serverUrl.replace(/\/$/, "") + "/v3";
        this.userKey = options.userKey;
        this.serviceId = options.serviceId || "default";
    }
    headers() {
        return {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.userKey}`,
            "x-tdai-service-id": this.serviceId,
        };
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
            method,
            headers: this.headers(),
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(30000),
        });
        const result = await response.json();
        if (result.code !== 0) {
            throw new Error(`API error ${result.code}: ${result.message}`);
        }
        return result.data;
    }
    /**
     * Health check
     */
    async health() {
        // Try /v3/health first, then fall back to root /health
        try {
            return await this.request("GET", "/health");
        }
        catch {
            // If that fails, try the root endpoint
            const url = `${this.baseUrl.replace("/v3", "")}/health`;
            const response = await fetch(url, {
                headers: this.headers(),
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) {
                return { status: "error" };
            }
            return response.json();
        }
    }
    // ==================== Skills API ====================
    /**
     * List all skills
     */
    async skillList() {
        const result = await this.request("POST", "/skill/list", {});
        return result;
    }
    /**
     * Get skill by name
     */
    async skillGet(name) {
        try {
            return await this.request("POST", "/skill/get", { name });
        }
        catch {
            return null;
        }
    }
    /**
     * Create or update skill
     */
    async skillCreate(options) {
        return this.request("POST", "/skill/create", {
            name: options.name,
            content: options.content,
            description: options.description,
            tags: options.tags,
        });
    }
    /**
     * Update skill
     */
    async skillUpdate(options) {
        return this.request("POST", "/skill/update", {
            name: options.name,
            content: options.content,
            description: options.description,
        });
    }
    /**
     * Delete skill
     */
    async skillDelete(name) {
        await this.request("POST", "/skill/delete", { name });
    }
    /**
     * Search skills
     */
    async skillSearch(query, limit = 10) {
        const result = await this.request("POST", "/skill/search", { query, limit });
        return result?.items || [];
    }
    // ==================== Knowledge API ====================
    /**
     * List knowledge items
     */
    async knowledgeList(teamId) {
        return this.request("POST", "/knowledge/list", { team_id: teamId || this.serviceId });
    }
    /**
     * Get knowledge by ID
     */
    async knowledgeGet(id) {
        try {
            return await this.request("POST", "/knowledge/get", { id });
        }
        catch {
            return null;
        }
    }
    /**
     * Create knowledge
     */
    async knowledgeCreate(options) {
        return this.request("POST", "/knowledge/create", {
            title: options.title,
            content: options.content,
            team_id: options.teamId || this.serviceId,
        });
    }
    /**
     * Update knowledge
     */
    async knowledgeUpdate(options) {
        return this.request("POST", "/knowledge/update", {
            id: options.id,
            title: options.title,
            content: options.content,
        });
    }
    /**
     * Delete knowledge
     */
    async knowledgeDelete(id) {
        await this.request("POST", "/knowledge/delete", { id });
    }
}
/**
 * Create TencentDB client
 */
export function createTencentDBClient(options) {
    return new TencentDBClient(options);
}
//# sourceMappingURL=client.js.map