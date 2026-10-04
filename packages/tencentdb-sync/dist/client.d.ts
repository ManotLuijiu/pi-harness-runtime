/**
 * TencentDB Knowledge Service Client (RFC-0105/0106)
 *
 * Client for TencentDB-Agent-Memory Knowledge Service
 * Base URL: https://your-memory-server.example.com/v3/
 */
export interface ApiResponse<T> {
    code: number;
    message: string;
    request_id?: string;
    data?: T;
}
export interface Skill {
    skill_id: string;
    name: string;
    description: string;
    version: number;
    is_head: boolean;
    status: string;
    owner_user_id: string;
    owner_agent_id: string;
    team_id: string;
    task_id: string;
    created_at_ms: number;
    updated_at_ms: number;
}
export interface SkillSearchResult extends Skill {
    score: number;
    snippet?: string;
}
export interface Knowledge {
    id: string;
    title: string;
    content: string;
    team_id: string;
    created_at_ms: number;
    updated_at_ms: number;
}
export interface HealthStatus {
    status: string;
    version?: string;
    uptime?: number;
    stores?: {
        vectorStore?: boolean;
    };
}
/**
 * TencentDB Knowledge Service API Client
 */
export declare class TencentDBClient {
    private baseUrl;
    private userKey;
    private serviceId;
    constructor(options: {
        serverUrl: string;
        userKey: string;
        serviceId?: string;
    });
    private headers;
    private request;
    /**
     * Health check
     */
    health(): Promise<HealthStatus>;
    /**
     * List all skills
     */
    skillList(): Promise<{
        items: Skill[];
        total: number;
    }>;
    /**
     * Get skill by name
     */
    skillGet(name: string): Promise<Skill | null>;
    /**
     * Create or update skill
     */
    skillCreate(options: {
        name: string;
        content: string;
        description?: string;
        tags?: string[];
    }): Promise<Skill>;
    /**
     * Update skill
     */
    skillUpdate(options: {
        name: string;
        content: string;
        description?: string;
    }): Promise<Skill>;
    /**
     * Delete skill
     */
    skillDelete(name: string): Promise<void>;
    /**
     * Search skills
     */
    skillSearch(query: string, limit?: number): Promise<SkillSearchResult[]>;
    /**
     * List knowledge items
     */
    knowledgeList(teamId?: string): Promise<{
        items: Knowledge[];
        total: number;
    }>;
    /**
     * Get knowledge by ID
     */
    knowledgeGet(id: string): Promise<Knowledge | null>;
    /**
     * Create knowledge
     */
    knowledgeCreate(options: {
        title: string;
        content: string;
        teamId?: string;
    }): Promise<Knowledge>;
    /**
     * Update knowledge
     */
    knowledgeUpdate(options: {
        id: string;
        title?: string;
        content?: string;
    }): Promise<Knowledge>;
    /**
     * Delete knowledge
     */
    knowledgeDelete(id: string): Promise<void>;
}
/**
 * Create TencentDB client
 */
export declare function createTencentDBClient(options: {
    serverUrl: string;
    userKey: string;
    serviceId?: string;
}): TencentDBClient;
//# sourceMappingURL=client.d.ts.map