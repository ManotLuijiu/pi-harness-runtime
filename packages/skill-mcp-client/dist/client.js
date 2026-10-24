/**
 * Skill MCP Client Implementation (RFC-0106)
 */
import { fetch } from "undici";
import { SkillAPIError } from "./errors.js";
import { ErrorCodes } from "./types.js";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESULTS = 20;
/**
 * MCP Client for Skills SaaS backend
 */
export class SkillMCPClient {
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
            throw new SkillAPIError(`HTTP ${response.status}: ${response.statusText}`, response.status, method);
        }
        const data = (await response.json());
        if (data.error) {
            throw new SkillAPIError(data.error.message, data.error.code, method);
        }
        if (!data.result) {
            throw new SkillAPIError("No result in response", ErrorCodes.INVALID_REQUEST, method);
        }
        return data.result;
    }
    /**
     * List available skills
     */
    async listSkills(params) {
        return this.request("skills.list", {
            ...params,
            limit: params?.limit ?? this.config.maxResults,
        });
    }
    /**
     * Get a skill's full prompt
     */
    async getSkill(params) {
        if (!params.id && !params.slug) {
            throw new SkillAPIError("Either 'id' or 'slug' is required", ErrorCodes.INVALID_PARAMS, "skills.get");
        }
        return this.request("skills.get", params);
    }
    /**
     * Sync all skills for the user's tier (bulk download)
     */
    async syncSkills(params) {
        return this.request("skills.sync", (params ?? {}));
    }
    /**
     * Get version history for a skill
     */
    async getSkillVersions(skillId, limit = 10) {
        return this.request("skills.versions", {
            id: skillId,
            limit,
        });
    }
    /**
     * List all categories
     */
    async listCategories() {
        return this.request("categories.list");
    }
    /**
     * Health check
     */
    async healthCheck() {
        return this.request("health.check");
    }
}
//# sourceMappingURL=client.js.map