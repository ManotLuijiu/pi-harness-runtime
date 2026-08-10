/**
 * Knowledge Graph - RFC-0106
 *
 * Typed definitions for knowledge graph nodes and edges.
 */

// --- Node Types ---

export type KnowledgeNodeType =
	| "skill" // SKILL.md entry
	| "rfc" // RFC document
	| "implementation" // IMPLEMENTATION/* entry
	| "concept" // Abstract concept
	| "api" // API endpoint
	| "cli" // CLI command
	| "pattern" // Code pattern
	| "workflow"; // Workflow/SOP

export interface KnowledgeNode {
	id: string; // e.g., "skill:frappe-custom-field-lifecycle"
	type: KnowledgeNodeType;
	data: {
		title: string;
		description?: string;
		tags: string[];
		source?: string; // File path
		url?: string; // RFC/IMPLEMENTATION URL
	};
}

// --- Edge Types ---

export type KnowledgeEdgeType =
	| "implements" // Skill implements RFC
	| "depends_on" // Skill A depends on Skill B
	| "supersedes" // New version replaces old
	| "related_to" // General relationship
	| "authored_by" // Author attribution
	| "documents" // RFC/Impl documents a skill
	| "references"; // RFC references implementation

export interface KnowledgeEdge {
	from: string; // Node ID
	to: string; // Node ID
	type: KnowledgeEdgeType;
	metadata?: {
		confidence?: number; // 0-1
		source?: string; // How was this edge discovered
	};
}

// --- Graph ---

export interface KnowledgeGraph {
	nodes: KnowledgeNode[];
	edges: KnowledgeEdge[];
}

export interface ProvenanceData {
	implements?: string; // RFC number (e.g., "RFC-0106")
	related_implementation?: string; // IMPLEMENTATION path
	author?: string;
	version?: string;
}

// --- Search ---

export interface SearchResult {
	node: KnowledgeNode;
	score: number;
	highlights?: string[];
}

export interface SearchOptions {
	limit?: number;
	type?: KnowledgeNodeType;
	tags?: string[];
}

// --- Config ---

export interface TencentDBConfig {
	knowledgeUrl: string; // http://{host}:8424
	userKey: string;
	serviceId: string;
}
