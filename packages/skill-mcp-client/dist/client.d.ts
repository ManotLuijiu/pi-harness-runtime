/**
 * Skill MCP Client Implementation (RFC-0106)
 */
import type { ListSkillsParams, ListSkillsResult, GetSkillParams, GetSkillResult, SyncSkillsParams, SyncSkillsResult, SkillVersionsResult, HealthResult } from "./types.js";
export interface SkillMCPClientConfig {
    /** Server URL (e.g., https://api.skills.example.com) */
    serverUrl: string;
    /** API key for authentication */
    apiKey?: string;
    /** Default max results per request */
    maxResults?: number;
    /** Request timeout in ms */
    timeoutMs?: number;
}
/**
 * MCP Client for Skills SaaS backend
 */
export declare class SkillMCPClient {
    private config;
    constructor(config: SkillMCPClientConfig);
    /**
     * Make MCP request to server
     */
    private request;
    /**
     * List available skills
     */
    listSkills(params?: ListSkillsParams): Promise<ListSkillsResult>;
    /**
     * Get a skill's full prompt
     */
    getSkill(params: GetSkillParams): Promise<GetSkillResult>;
    /**
     * Sync all skills for the user's tier (bulk download)
     */
    syncSkills(params?: SyncSkillsParams): Promise<SyncSkillsResult>;
    /**
     * Get version history for a skill
     */
    getSkillVersions(skillId: string, limit?: number): Promise<SkillVersionsResult>;
    /**
     * List all categories
     */
    listCategories(): Promise<{
        categories: Array<{
            slug: string;
            displayName: string;
            skillCount: number;
        }>;
    }>;
    /**
     * Health check
     */
    healthCheck(): Promise<HealthResult>;
}
//# sourceMappingURL=client.d.ts.map