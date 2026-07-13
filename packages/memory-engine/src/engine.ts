/**
 * Memory Engine (RFC-0060)
 *
 * Manages durable knowledge using Google's Open Knowledge Format (OKF).
 */

import { randomUUID } from "node:crypto";
import type {
	OkfConcept,
	OkfFrontmatter,
	OkfLink,
	KnowledgeBundle,
	ValidationResult,
	ValidationError,
	KnowledgeQuery,
	KnowledgeResult,
	WriteConceptRequest,
} from "./types.js";
import { filterSecrets, AUTHORITY_PRIORITY, type Authority } from "./types.js";

// ─── YAML Frontmatter Parsing ─────────────────────────────────────────────────

function parseFrontmatter(
	content: string,
): { frontmatter: OkfFrontmatter; body: string; raw: string } | null {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

	if (!match) {
		return null;
	}

	const [, yamlStr, body] = match;
	const frontmatter: OkfFrontmatter = { type: "" };
	const lines = yamlStr.split("\n");

	for (const line of lines) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();

		if (value.startsWith("[") && value.endsWith("]")) {
			// Array
			frontmatter[key] = value
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim());
		} else if (value === "true") {
			frontmatter[key] = true;
		} else if (value === "false") {
			frontmatter[key] = false;
		} else {
			frontmatter[key] = value.replace(/^["']|["']$/g, "");
		}
	}

	return { frontmatter, body: body.trim(), raw: yamlStr };
}

function serializeFrontmatter(data: OkfFrontmatter): string {
	const lines: string[] = [];

	for (const [key, value] of Object.entries(data)) {
		if (value === undefined || value === null) continue;

		if (Array.isArray(value)) {
			lines.push(`${key}: [${value.join(", ")}]`);
		} else if (typeof value === "boolean") {
			lines.push(`${key}: ${value}`);
		} else if (typeof value === "object") {
			lines.push(`${key}: ${JSON.stringify(value)}`);
		} else {
			lines.push(`${key}: ${value}`);
		}
	}

	return lines.join("\n");
}

// ─── Concept Parsing ────────────────────────────────────────────────────────

// ─── Link Extraction ─────────────────────────────────────────────────────────

/**
 * Extract markdown links from content
 * Used for link validation and concept parsing
 */
export function extractLinks(markdown: string): OkfLink[] {
	const links: OkfLink[] = [];

	// Extract markdown links
	const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
	let match;
	while ((match = linkRegex.exec(markdown)) !== null) {
		links.push({
			href: match[2],
			title: match[1],
		});
	}

	return links;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function validateConcept(
	content: string,
	path: string,
): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationError[] = [];

	// Check for YAML frontmatter
	if (!content.startsWith("---")) {
		errors.push({
			path,
			message: "Missing YAML frontmatter",
			severity: "error",
		});
		return { valid: false, errors, warnings };
	}

	// Parse frontmatter
	const parsed = parseFrontmatter(content);
	if (!parsed) {
		errors.push({
			path,
			message: "Invalid YAML frontmatter",
			severity: "error",
		});
		return { valid: false, errors, warnings };
	}

	// Check for required type field
	if (!parsed.frontmatter.type) {
		errors.push({
			path,
			message: "Missing required 'type' field in frontmatter",
			severity: "error",
		});
	}

	// Check for broken links - extractLinks would be used for validation
	// Note: link validation would be done here with filesystem access

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

// ─── Index Generation ─────────────────────────────────────────────────────────

function generateIndex(concepts: OkfConcept[]): string {
	const lines = [
		"# Knowledge Index",
		"",
		`Last updated: ${new Date().toISOString()}`,
		"",
		"## By Type",
		"",
	];

	// Group by type
	const byType = new Map<string, OkfConcept[]>();
	for (const concept of concepts) {
		const existing = byType.get(concept.type) || [];
		existing.push(concept);
		byType.set(concept.type, existing);
	}

	for (const [type, typeConcepts] of byType) {
		lines.push(`### ${type}`);
		for (const concept of typeConcepts) {
			const title = concept.title || concept.id;
			lines.push(`- [[${title}]]`);
		}
		lines.push("");
	}

	// Group by tag
	lines.push("## By Tag");
	lines.push("");
	const byTag = new Map<string, OkfConcept[]>();
	for (const concept of concepts) {
		for (const tag of concept.tags) {
			const existing = byTag.get(tag) || [];
			existing.push(concept);
			byTag.set(tag, existing);
		}
	}

	for (const [tag, tagConcepts] of byTag) {
		lines.push(`### #${tag}`);
		for (const concept of tagConcepts) {
			const title = concept.title || concept.id;
			lines.push(`- [[${title}]]`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Search ──────────────────────────────────────────────────────────────────

function calculateRelevance(
	concept: OkfConcept,
	query: KnowledgeQuery,
): number {
	let score = 0;
	const matchedOn: KnowledgeResult["matchedOn"] = [];

	// Title match
	if (
		query.text &&
		concept.title?.toLowerCase().includes(query.text.toLowerCase())
	) {
		score += 30;
		matchedOn.push("title");
	}

	// Tag match
	if (query.tags) {
		for (const tag of query.tags) {
			if (concept.tags.includes(tag)) {
				score += 20;
				matchedOn.push("tags");
				break;
			}
		}
	}

	// Type match
	if (query.types && query.types.includes(concept.type)) {
		score += 15;
		matchedOn.push("type");
	}

	// Authority match
	const authority = (concept.metadata?.authority as Authority) || "unverified";
	if (query.authority && query.authority.includes(authority)) {
		score += 10 * AUTHORITY_PRIORITY[authority];
		matchedOn.push("authority");
	}

	// Body match
	if (
		query.text &&
		concept.body.toLowerCase().includes(query.text.toLowerCase())
	) {
		score += 5;
	}

	return score;
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export class MemoryEngine {
	private bundle: KnowledgeBundle | null = null;

	private ensureBundle(): KnowledgeBundle {
		if (!this.bundle) {
			this.bundle = {
				path: "memory://in-memory",
				concepts: [],
				index: "",
				log: "",
				directories: [],
			};
		}

		return this.bundle;
	}

	/**
	 * Load an OKF bundle from a directory path
	 */
	async loadBundle(path: string): Promise<KnowledgeBundle> {
		// In a real implementation, this would recursively read files from disk
		// For now, we return an empty bundle
		this.bundle = {
			path,
			concepts: [],
			index: "",
			log: "",
			directories: [],
		};
		return this.bundle;
	}

	/**
	 * Validate a bundle
	 */
	validateBundle(bundle: KnowledgeBundle): ValidationResult {
		const errors: ValidationError[] = [];
		const warnings: ValidationError[] = [];

		for (const concept of bundle.concepts) {
			if (!concept.type) {
				errors.push({
					path: concept.id,
					message: "Concept missing required 'type' field",
					severity: "error",
				});
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
		};
	}

	/**
	 * Search for concepts matching a query
	 */
	search(query: KnowledgeQuery): KnowledgeResult[] {
		const bundle = this.ensureBundle();
		const results: KnowledgeResult[] = [];

		for (const concept of bundle.concepts) {
			// Filter by authority
			if (query.authority) {
				const authority =
					(concept.metadata?.authority as Authority) || "unverified";
				if (!query.authority.includes(authority)) {
					continue;
				}
			}

			// Filter by type
			if (query.types && !query.types.includes(concept.type)) {
				continue;
			}

			// Filter by tags
			if (query.tags) {
				const hasTag = query.tags.some((t) => concept.tags.includes(t));
				if (!hasTag) {
					continue;
				}
			}

			const relevance = calculateRelevance(concept, query);
			if (relevance > 0 || !query.text) {
				results.push({
					concept,
					relevance,
					matchedOn: [],
				});
			}
		}

		// Sort by relevance
		results.sort((a, b) => b.relevance - a.relevance);

		// Apply limit
		if (query.limit) {
			return results.slice(0, query.limit);
		}

		return results;
	}

	/**
	 * Write a new concept
	 */
	writeConcept(request: WriteConceptRequest): OkfConcept {
		const id = randomUUID();
		const timestamp = new Date().toISOString();

		const concept: OkfConcept = {
			id,
			type: request.type,
			title: request.title,
			tags: request.tags || [],
			timestamp,
			metadata: {
				...request.metadata,
				authority: request.authority || "generated",
			},
			body: request.body,
			links: request.links || [],
		};

		const bundle = this.ensureBundle();
		bundle.concepts.push(concept);
		bundle.index = generateIndex(bundle.concepts);

		return concept;
	}

	/**
	 * Promote a concept from the blackboard
	 */
	promoteFromBlackboard(
		blackboardContent: string,
		metadata: Record<string, unknown>,
	): WriteConceptRequest {
		// Filter secrets before promoting
		const filteredContent = filterSecrets(blackboardContent);

		return {
			type: (metadata.type as string) || "knowledge",
			title: metadata.title as string,
			body: filteredContent,
			tags: (metadata.tags as string[]) || [],
			authority: (metadata.authority as Authority) || "unverified",
			metadata,
		};
	}

	/**
	 * Rebuild the index
	 */
	async rebuildIndex(path: string): Promise<void> {
		if (!this.bundle || this.bundle.path !== path) {
			await this.loadBundle(path);
		}

		if (this.bundle) {
			this.bundle.index = generateIndex(this.bundle.concepts);
		}
	}

	/**
	 * Get the current bundle
	 */
	getBundle(): KnowledgeBundle | null {
		return this.bundle;
	}

	/**
	 * Export a concept to OKF format
	 */
	exportToOkf(concept: OkfConcept): string {
		const frontmatter: OkfFrontmatter = {
			type: concept.type,
			title: concept.title,
			tags: concept.tags,
			timestamp: concept.timestamp,
			...concept.metadata,
		};

		const lines = [
			"---",
			serializeFrontmatter(frontmatter),
			"---",
			"",
			concept.body,
		];

		if (concept.links.length > 0) {
			lines.push("");
			lines.push("## Links");
			for (const link of concept.links) {
				lines.push(`- [${link.title || link.href}](${link.href})`);
			}
		}

		return lines.join("\n");
	}
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createMemoryEngine(): MemoryEngine {
	return new MemoryEngine();
}
