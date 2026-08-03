/**
 * TencentDB Memory Client Types (RFC-0105)
 *
 * Client for TencentDB-Agent-Memory server API.
 * Syncs skills and knowledge to centralized memory server.
 */

// --- Config Types ------------------------------------------------------------

export interface TencentDBConfig {
	/** Server URL (e.g., http://localhost:3000 or https://memory.example.com) */
	serverUrl: string;
	/** API key for authentication */
	apiKey?: string;
	/** Default embedding model */
	embeddingModel?: string;
	/** Chunk size for documents */
	chunkSize?: number;
	/** Chunk overlap */
	chunkOverlap?: number;
}

export const DEFAULT_CONFIG: Partial<TencentDBConfig> = {
	chunkSize: 512,
	chunkOverlap: 50,
	embeddingModel: "bge-m3",
};

// --- Skill Types (from SKILL.md) ----------------------------------------------

export interface SkillMetadata {
	/** Skill name (slug) */
	name: string;
	/** Skill description */
	description: string;
	/** When to use this skill */
	whenToUse?: string;
	/** List of procedure steps */
	procedureSteps?: string[];
	/** Pitfalls and gotchas */
	pitfalls?: string[];
	/** Verification steps */
	verificationSteps?: string[];
	/** Related skills */
	relatedSkills?: string[];
	/** Tags for categorization */
	tags: string[];
	/** Source file path */
	sourcePath: string;
	/** Last modified */
	lastModified: string;
}

// --- API Types ----------------------------------------------------------------

export interface SyncRequest {
	/** Skills to sync */
	skills: SkillMetadata[];
	/** Force sync (ignore timestamp check) */
	force?: boolean;
}

export interface SyncResponse {
	success: boolean;
	synced: number;
	failed: number;
	errors?: string[];
}

export interface SearchRequest {
	/** Query text */
	query: string;
	/** Filter by tags */
	tags?: string[];
	/** Maximum results */
	limit?: number;
	/** Include skill details */
	includeDetails?: boolean;
}

export interface SearchResult {
	id: string;
	name: string;
	description: string;
	tags: string[];
	similarity: number;
	/** Full skill content if includeDetails=true */
	content?: string;
	metadata?: SkillMetadata;
}

export interface DeleteRequest {
	/** Skill name(s) to delete */
	names: string[];
}

export interface HealthResponse {
	status: "ok" | "error";
	version: string;
	skillsCount: number;
}
