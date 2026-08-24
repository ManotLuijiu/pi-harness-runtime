/**
 * Skill MCP Client Implementation (RFC-0106)
 */

import { fetch } from "undici";
import type {
  ListSkillsParams,
  ListSkillsResult,
  GetSkillParams,
  GetSkillResult,
  SyncSkillsParams,
  SyncSkillsResult,
  SkillVersionsResult,
  HealthResult,
  MCPRequest,
  MCPResponse,
} from "./types.js";
import { SkillAPIError } from "./errors.js";
import { ErrorCodes } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESULTS = 20;

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
export class SkillMCPClient {
  private config: Required<SkillMCPClientConfig>;

  constructor(config: SkillMCPClientConfig) {
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
      } satisfies MCPRequest),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new SkillAPIError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        method,
      );
    }

    const data = (await response.json()) as MCPResponse<T>;

    if (data.error) {
      throw new SkillAPIError(data.error.message, data.error.code, method);
    }

    if (!data.result) {
      throw new SkillAPIError(
        "No result in response",
        ErrorCodes.INVALID_REQUEST,
        method,
      );
    }

    return data.result;
  }

  /**
   * List available skills
   */
  async listSkills(params?: ListSkillsParams): Promise<ListSkillsResult> {
    return this.request<ListSkillsResult>("skills.list", {
      ...params,
      limit: params?.limit ?? this.config.maxResults,
    });
  }

  /**
   * Get a skill's full prompt
   */
  async getSkill(params: GetSkillParams): Promise<GetSkillResult> {
    if (!params.id && !params.slug) {
      throw new SkillAPIError(
        "Either 'id' or 'slug' is required",
        ErrorCodes.INVALID_PARAMS,
        "skills.get",
      );
    }
    return this.request<GetSkillResult>(
      "skills.get",
      params as Record<string, unknown>,
    );
  }

  /**
   * Sync all skills for the user's tier (bulk download)
   */
  async syncSkills(params?: SyncSkillsParams): Promise<SyncSkillsResult> {
    return this.request<SyncSkillsResult>(
      "skills.sync",
      (params ?? {}) as Record<string, unknown>,
    );
  }

  /**
   * Get version history for a skill
   */
  async getSkillVersions(
    skillId: string,
    limit = 10,
  ): Promise<SkillVersionsResult> {
    return this.request<SkillVersionsResult>("skills.versions", {
      id: skillId,
      limit,
    });
  }

  /**
   * List all categories
   */
  async listCategories(): Promise<{
    categories: Array<{
      slug: string;
      displayName: string;
      skillCount: number;
    }>;
  }> {
    return this.request("categories.list");
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthResult> {
    return this.request<HealthResult>("health.check");
  }
}
