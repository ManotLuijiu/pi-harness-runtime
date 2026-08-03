/**
 * TencentDB Memory Client (RFC-0105)
 *
 * Client for TencentDB-Agent-Memory server API.
 * Handles skill sync, search, and management.
 */

import type {
	TencentDBConfig,
	SyncRequest,
	SyncResponse,
	SearchRequest,
	SearchResult,
	DeleteRequest,
	HealthResponse,
	SkillMetadata,
	DEFAULT_CONFIG,
} from "./types.js";

export class TencentDBMemoryClient {
	private config: Required<TencentDBConfig>;
	private baseUrl: string;
	private headers: Record<string, string>;

	constructor(config: TencentDBConfig) {
		this.config = { ...DEFAULT_CONFIG, ...config } as Required<TencentDBConfig>;
		this.baseUrl = this.config.serverUrl.replace(/\/$/, "");
		this.headers = {
			"Content-Type": "application/json",
		};
		if (this.config.apiKey) {
			this.headers["Authorization"] = `Bearer ${this.config.apiKey}`;
		}
	}

	/**
	 * Check server health
	 */
	async health(): Promise<HealthResponse> {
		const response = await fetch(`${this.baseUrl}/health`, {
			headers: this.headers,
		});
		if (!response.ok) {
			throw new Error(`Health check failed: ${response.statusText}`);
		}
		return response.json();
	}

	/**
	 * Sync skills to server
	 */
	async syncSkills(request: SyncRequest): Promise<SyncResponse> {
		const response = await fetch(`${this.baseUrl}/api/skills/sync`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(request),
		});
		if (!response.ok) {
			throw new Error(`Sync failed: ${response.statusText}`);
		}
		return response.json();
	}

	/**
	 * Search skills
	 */
	async searchSkills(request: SearchRequest): Promise<SearchResult[]> {
		const response = await fetch(`${this.baseUrl}/api/skills/search`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(request),
		});
		if (!response.ok) {
			throw new Error(`Search failed: ${response.statusText}`);
		}
		return response.json();
	}

	/**
	 * Get skill by name
	 */
	async getSkill(name: string): Promise<SkillMetadata | null> {
		const response = await fetch(
			`${this.baseUrl}/api/skills/${encodeURIComponent(name)}`,
			{ headers: this.headers },
		);
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			throw new Error(`Get skill failed: ${response.statusText}`);
		}
		return response.json();
	}

	/**
	 * Delete skills
	 */
	async deleteSkills(request: DeleteRequest): Promise<{ deleted: number }> {
		const response = await fetch(`${this.baseUrl}/api/skills/delete`, {
			method: "DELETE",
			headers: this.headers,
			content: JSON.stringify(request),
		});
		if (!response.ok) {
			throw new Error(`Delete failed: ${response.statusText}`);
		}
		return response.json();
	}

	/**
	 * List all skills
	 */
	async listSkills(): Promise<SkillMetadata[]> {
		const response = await fetch(`${this.baseUrl}/api/skills`, {
			headers: this.headers,
		});
		if (!response.ok) {
			throw new Error(`List skills failed: ${response.statusText}`);
		}
		return response.json();
	}
}

/**
 * Create TencentDB Memory client
 */
export function createTencentDBClient(config: TencentDBConfig): TencentDBMemoryClient {
	return new TencentDBMemoryClient(config);
}
