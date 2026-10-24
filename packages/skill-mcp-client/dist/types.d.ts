/**
 * Skill MCP Client Types (RFC-0106)
 */
export interface SkillInfo {
    id: string;
    name: string;
    slug: string;
    description: string;
    version: string;
    tier: "free" | "pro" | "enterprise";
    tags: string[];
    category: string;
    updatedAt: string;
}
export interface CategoryInfo {
    slug: string;
    displayName: string;
    skillCount: number;
}
export interface GetSkillResult {
    id: string;
    name: string;
    slug: string;
    description: string;
    version: string;
    tier: "free" | "pro" | "enterprise";
    tags: string[];
    category: CategoryInfo;
    updatedAt: string;
    prompt: string;
    changelog?: string;
    previousVersions?: string[];
}
export interface SyncSkillsResult {
    skills: GetSkillResult[];
    syncedAt: string;
    nextSyncDue?: string;
}
export interface SkillVersion {
    version: string;
    changelog: string;
    releasedAt: string;
}
export interface SkillVersionsResult {
    skillId: string;
    currentVersion: string;
    versions: SkillVersion[];
}
export interface HealthResult {
    status: "ok" | "degraded";
    version: string;
    databaseLatencyMs: number;
}
export interface ListSkillsParams {
    category?: string;
    tier?: "free" | "pro" | "enterprise";
    tags?: string[];
    search?: string;
    limit?: number;
    offset?: number;
}
export interface ListSkillsResult {
    skills: SkillInfo[];
    total: number;
    categories: CategoryInfo[];
}
export interface GetSkillParams {
    id?: string;
    slug?: string;
    version?: string;
}
export interface SyncSkillsParams {
    categories?: string[];
    forceRefresh?: boolean;
}
export interface SkillVersionsParams {
    id: string;
    limit?: number;
}
export interface MCPRequest {
    jsonrpc: "2.0";
    id: string;
    method: string;
    params?: Record<string, unknown>;
}
export interface MCPResponse<T = unknown> {
    jsonrpc: "2.0";
    id: string;
    result?: T;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
export declare const ErrorCodes: {
    readonly INVALID_REQUEST: -32600;
    readonly INVALID_PARAMS: -32602;
    readonly METHOD_NOT_FOUND: -32601;
    readonly UNAUTHORIZED: -32001;
    readonly TIER_RESTRICTED: -32002;
    readonly NOT_FOUND: -32003;
    readonly RATE_LIMITED: -32004;
};
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
//# sourceMappingURL=types.d.ts.map