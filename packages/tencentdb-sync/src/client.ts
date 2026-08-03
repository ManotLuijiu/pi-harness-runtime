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
  stores?: { vectorStore?: boolean };
}

/**
 * TencentDB Knowledge Service API Client
 */
export class TencentDBClient {
  private baseUrl: string;
  private userKey: string;
  private serviceId: string;

  constructor(options: {
    serverUrl: string;
    userKey: string;
    serviceId?: string;
  }) {
    // Remove trailing slash and ensure /v3/ path
    this.baseUrl = options.serverUrl.replace(/\/$/, "") + "/v3";
    this.userKey = options.userKey;
    this.serviceId = options.serviceId || "default";
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.userKey}`,
      "x-tdai-service-id": this.serviceId,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });

    const result = await response.json() as ApiResponse<T>;

    if (result.code !== 0) {
      throw new Error(`API error ${result.code}: ${result.message}`);
    }

    return result.data as T;
  }

  /**
   * Health check
   */
  async health(): Promise<HealthStatus> {
    // Try /v3/health first, then fall back to root /health
    try {
      return await this.request<HealthStatus>("GET", "/health");
    } catch {
      // If that fails, try the root endpoint
      const url = `${this.baseUrl.replace("/v3", "")}/health`;
      const response = await fetch(url, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { status: "error" };
      }
      return response.json() as Promise<HealthStatus>;
    }
  }

  // ==================== Skills API ====================

  /**
   * List all skills
   */
  async skillList(): Promise<{ items: Skill[]; total: number }> {
    const result = await this.request<{ items: Skill[]; total: number }>(
      "POST",
      "/skill/list",
      {},
    );
    return result;
  }

  /**
   * Get skill by name
   */
  async skillGet(name: string): Promise<Skill | null> {
    try {
      return await this.request<Skill>("POST", "/skill/get", { name });
    } catch {
      return null;
    }
  }

  /**
   * Create or update skill
   */
  async skillCreate(options: {
    name: string;
    content: string;
    description?: string;
    tags?: string[];
  }): Promise<Skill> {
    return this.request<Skill>("POST", "/skill/create", {
      name: options.name,
      content: options.content,
      description: options.description,
      tags: options.tags,
    });
  }

  /**
   * Update skill
   */
  async skillUpdate(options: {
    name: string;
    content: string;
    description?: string;
  }): Promise<Skill> {
    return this.request<Skill>("POST", "/skill/update", {
      name: options.name,
      content: options.content,
      description: options.description,
    });
  }

  /**
   * Delete skill
   */
  async skillDelete(name: string): Promise<void> {
    await this.request("POST", "/skill/delete", { name });
  }

  /**
   * Search skills
   */
  async skillSearch(query: string, limit = 10): Promise<SkillSearchResult[]> {
    const result = await this.request<{ items: SkillSearchResult[] }>(
      "POST",
      "/skill/search",
      { query, limit },
    );
    return result?.items || [];
  }

  // ==================== Knowledge API ====================

  /**
   * List knowledge items
   */
  async knowledgeList(teamId?: string): Promise<{ items: Knowledge[]; total: number }> {
    return this.request<{ items: Knowledge[]; total: number }>(
      "POST",
      "/knowledge/list",
      { team_id: teamId || this.serviceId },
    );
  }

  /**
   * Get knowledge by ID
   */
  async knowledgeGet(id: string): Promise<Knowledge | null> {
    try {
      return await this.request<Knowledge>("POST", "/knowledge/get", { id });
    } catch {
      return null;
    }
  }

  /**
   * Create knowledge
   */
  async knowledgeCreate(options: {
    title: string;
    content: string;
    teamId?: string;
  }): Promise<Knowledge> {
    return this.request<Knowledge>("POST", "/knowledge/create", {
      title: options.title,
      content: options.content,
      team_id: options.teamId || this.serviceId,
    });
  }

  /**
   * Update knowledge
   */
  async knowledgeUpdate(options: {
    id: string;
    title?: string;
    content?: string;
  }): Promise<Knowledge> {
    return this.request<Knowledge>("POST", "/knowledge/update", {
      id: options.id,
      title: options.title,
      content: options.content,
    });
  }

  /**
   * Delete knowledge
   */
  async knowledgeDelete(id: string): Promise<void> {
    await this.request("POST", "/knowledge/delete", { id });
  }
}

/**
 * Create TencentDB client
 */
export function createTencentDBClient(options: {
  serverUrl: string;
  userKey: string;
  serviceId?: string;
}): TencentDBClient {
  return new TencentDBClient(options);
}
