/**
 * Memory Engine Types (RFC-0060)
 *
 * Interfaces for OKF-based knowledge management.
 */

// ─── OKF Concept Types ─────────────────────────────────────────────────────────

export interface OkfLink {
	href: string;
	title?: string;
	type?: string;
}

export interface OkfConcept {
	id: string;
	type: string;
	title?: string;
	description?: string;
	resource?: string;
	tags: string[];
	timestamp?: string;
	metadata: Record<string, unknown>;
	body: string;
	links: OkfLink[];
}

export interface OkfFrontmatter {
	type: string;
	title?: string;
	tags?: string[];
	timestamp?: string;
	authority?: "approved" | "generated" | "unverified";
	[key: string]: unknown;
}

// ─── Bundle Types ─────────────────────────────────────────────────────────────

export interface KnowledgeBundle {
	path: string;
	concepts: OkfConcept[];
	index: string;
	log: string;
	directories: KnowledgeDirectory[];
}

export interface KnowledgeDirectory {
	path: string;
	name: string;
	files: string[];
	subdirectories: KnowledgeDirectory[];
}

// ─── Validation Types ──────────────────────────────────────────────────────────

export interface ValidationError {
	path: string;
	message: string;
	line?: number;
	severity: "error" | "warning";
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
	warnings: ValidationError[];
}

// ─── Search Types ─────────────────────────────────────────────────────────────

export interface KnowledgeQuery {
	text?: string;
	tags?: string[];
	types?: string[];
	authority?: ("approved" | "generated" | "unverified")[];
	framework?: string;
	taskType?: string;
	limit?: number;
}

export interface KnowledgeResult {
	concept: OkfConcept;
	relevance: number;
	matchedOn: ("title" | "tags" | "type" | "body" | "authority")[];
}

// ─── Write Types ──────────────────────────────────────────────────────────────

export interface WriteConceptRequest {
	type: string;
	title?: string;
	body: string;
	tags?: string[];
	authority?: "approved" | "generated" | "unverified";
	metadata?: Record<string, unknown>;
	links?: OkfLink[];
}

// ─── Index Types ─────────────────────────────────────────────────────────────

export interface KnowledgeIndex {
	concepts: Array<{
		id: string;
		type: string;
		title: string;
		tags: string[];
		path: string;
	}>;
	lastUpdated: string;
}

// ─── Reserved Files ───────────────────────────────────────────────────────────

export const RESERVED_FILES = ["index.md", "log.md"];

export function isReservedFile(filename: string): boolean {
	return RESERVED_FILES.includes(filename);
}

// ─── Secret Detection ─────────────────────────────────────────────────────────

export const SECRET_PATTERNS = [
	/api[_-]?key/i,
	/password/i,
	/secret/i,
	/token/i,
	/bearer/i,
	/auth/i,
	/credential/i,
	/private[_-]?key/i,
	/access[_-]?token/i,
	/refresh[_-]?token/i,
];

export function containsSecret(value: string): boolean {
	return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function filterSecrets(content: string): string {
	return content.replace(
		/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]+)/g,
		(match, key: string) => {
			if (containsSecret(key)) {
				return `${key}=[REDACTED]`;
			}
			return match;
		},
	);
}

// ─── Authority Types ─────────────────────────────────────────────────────────

export type Authority = "approved" | "generated" | "unverified";

export const AUTHORITY_PRIORITY: Record<Authority, number> = {
	approved: 3,
	generated: 2,
	unverified: 1,
};
