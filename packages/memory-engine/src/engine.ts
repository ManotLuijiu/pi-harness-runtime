/**
 * Memory Engine (RFC-0060)
 *
 * Manages durable knowledge using Google's Open Knowledge Format (OKF).
 */

import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { resolve, join, relative } from "path";
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
import {
	filterSecrets,
	AUTHORITY_PRIORITY,
	type Authority,
	RESERVED_FILES,
} from "./types.js";

// ─── YAML Frontmatter Parsing ─────────────────────────────────────────────────

function parseFrontmatter(
	content: string,
): { frontmatter: OkfFrontmatter; body: string; raw: string } | null {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return null;

	const [, yamlStr, body] = match;
	const frontmatter: OkfFrontmatter = { type: "" };

	for (const line of yamlStr.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();
		if (!key) continue;

		if (value.startsWith("[") && value.endsWith("]")) {
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
		} else if (typeof value === "boolean" || typeof value === "object") {
			lines.push(`${key}: ${JSON.stringify(value)}`);
		} else {
			lines.push(`${key}: ${value}`);
		}
	}
	return lines.join("\n");
}

// ─── Link Extraction ───────────────────────────────────────────────────────────

export function extractLinks(markdown: string): OkfLink[] {
	const links: OkfLink[] = [];
	const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
	let match;
	while ((match = linkRegex.exec(markdown)) !== null) {
		links.push({ href: match[2], title: match[1] });
	}
	return links;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateConcept(
	content: string,
	path: string,
): ValidationResult {
	const errors: ValidationError[] = [];
	const warnings: ValidationError[] = [];

	if (!content.startsWith("---")) {
		errors.push({ path, message: "Missing YAML frontmatter", severity: "error" });
		return { valid: false, errors, warnings };
	}

	const parsed = parseFrontmatter(content);
	if (!parsed) {
		errors.push({ path, message: "Invalid YAML frontmatter", severity: "error" });
		return { valid: false, errors, warnings };
	}

	if (!parsed.frontmatter.type) {
		errors.push({
			path,
			message: "Missing required 'type' field in frontmatter",
			severity: "error",
		});
	}

	return { valid: errors.length === 0, errors, warnings };
}

// ─── Index Generation ────────────────────────────────────────────────────────

function generateIndex(concepts: OkfConcept[]): string {
	const lines = [
		"# Knowledge Index",
		"",
		`Last updated: ${new Date().toISOString()}`,
		"",
		"## By Type",
		"",
	];

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

// ─── Search ───────────────────────────────────────────────────────────────────

function calculateRelevance(
	concept: OkfConcept,
	query: KnowledgeQuery,
): number {
	let score = 0;
	const matchedOn: KnowledgeResult["matchedOn"] = [];

	if (
		query.text &&
		concept.title?.toLowerCase().includes(query.text.toLowerCase())
	) {
		score += 30;
		matchedOn.push("title");
	}

	if (query.tags) {
		for (const tag of query.tags) {
			if (concept.tags.includes(tag)) {
				score += 20;
				matchedOn.push("tags");
				break;
			}
		}
	}

	if (query.types && query.types.includes(concept.type)) {
		score += 15;
		matchedOn.push("type");
	}

	const authority =
		(concept.metadata?.authority as Authority) || "unverified";
	if (query.authority && query.authority.includes(authority)) {
		score += 10 * AUTHORITY_PRIORITY[authority];
		matchedOn.push("authority");
	}

	if (
		query.text &&
		concept.body.toLowerCase().includes(query.text.toLowerCase())
	) {
		score += 5;
	}

	return score;
}

// ─── Slug Generation ─────────────────────────────────────────────────────────

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
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
	 * Load an OKF bundle from a directory path.
	 * Recursively walks the directory tree, skipping reserved files (index.md, log.md)
	 * and node_modules. index.md and log.md are loaded as bundle metadata.
	 */
	async loadBundle(bundlePath: string): Promise<KnowledgeBundle> {
		const concepts: OkfConcept[] = [];
		const directories: KnowledgeBundle["directories"] = [];

		async function walkDir(
			dir: string,
			relPath: string = "",
		): Promise<void> {
			let entries;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}

			const subdirs: string[] = [];
			for (const entry of entries) {
				const full = join(dir, entry.name);
				const rel = relPath ? `${relPath}/${entry.name}` : entry.name;

				if (entry.isDirectory()) {
					if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
						subdirs.push(entry.name);
						await walkDir(full, rel);
					}
				} else if (entry.name === "index.md") {
					// index.md is bundle metadata, not a concept
					continue;
				} else if (entry.name === "log.md") {
					// log.md is bundle metadata, not a concept
					continue;
				} else if (entry.name.endsWith(".md")) {
					try {
						const content = await readFile(full, "utf-8");
						const concept = this_._parseConceptFromFile(content, rel);
						if (concept) concepts.push(concept);
					} catch {
						// Skip unreadable files
					}
				}
			}

			if (subdirs.length > 0) {
				directories.push({
					path: relPath || ".",
					name: relPath.split("/").pop() || ".",
					files: [],
					subdirectories: subdirs,
				});
			}
		}

		const this_ = this;
		await walkDir(bundlePath);

		// Load index.md and log.md as bundle metadata
		let indexContent = "";
		let logContent = "";

		try {
			indexContent =
				(await readFile(join(bundlePath, "index.md"), "utf-8").catch(
					() => "",
				)) ?? "";
		} catch {
			indexContent = "";
		}

		try {
			logContent =
				(await readFile(join(bundlePath, "log.md"), "utf-8").catch(() => "")) ?? "";
		} catch {
			logContent = "";
		}

		this.bundle = {
			path: bundlePath,
			concepts,
			index: indexContent,
			log: logContent,
			directories,
		};

		return this.bundle;
	}

	private _parseConceptFromFile(
		content: string,
		filePath: string,
	): OkfConcept | null {
		const parsed = parseFrontmatter(content);
		if (!parsed) return null;

		const fm = parsed.frontmatter;
		const body = parsed.body;

		// Build concept ID from file path
		const id = filePath.replace(/\.md$/, "");

		return {
			id,
			type: fm.type || "unknown",
			title: fm.title as string | undefined,
			description: fm.description as string | undefined,
			resource: fm.resource as string | undefined,
			tags: (fm.tags as string[]) || [],
			timestamp: fm.timestamp as string | undefined,
			metadata: Object.fromEntries(
				Object.entries(fm).filter(
					([k]) =>
						![
							"type",
							"title",
							"description",
							"resource",
							"tags",
							"timestamp",
							"authority",
						].includes(k),
				),
			),
			body,
			links: extractLinks(body),
		};
	}

	/**
	 * Validate a bundle
	 */
	validateBundle(bundle: KnowledgeBundle): ValidationResult {
		const errors: ValidationError[] = [];
		const warnings: ValidationError[] = [];

		for (const concept of bundle.concepts) {
			if (!concept.type || concept.type === "unknown") {
				errors.push({
					path: concept.id,
					message: "Concept missing required 'type' field",
					severity: "error",
				});
			}
		}

		return { valid: errors.length === 0, errors, warnings };
	}

	/**
	 * Search for concepts matching a query
	 */
	search(query: KnowledgeQuery): KnowledgeResult[] {
		const bundle = this.ensureBundle();
		const results: KnowledgeResult[] = [];

		for (const concept of bundle.concepts) {
			if (query.authority) {
				const authority =
					(concept.metadata?.authority as Authority) || "unverified";
				if (!query.authority.includes(authority)) continue;
			}
			if (query.types && !query.types.includes(concept.type)) continue;
			if (query.tags) {
				const hasTag = query.tags.some((t) => concept.tags.includes(t));
				if (!hasTag) continue;
			}

			const relevance = calculateRelevance(concept, query);
			if (relevance > 0 || !query.text) {
				results.push({ concept, relevance, matchedOn: [] });
			}
		}

		results.sort((a, b) => b.relevance - a.relevance);
		if (query.limit) return results.slice(0, query.limit);
		return results;
	}

	/**
	 * Write a concept to disk (persistence) and update in-memory bundle.
	 *
	 * Writes to: {bundlePath}/{type}/{slug}.md
	 * If bundlePath is not set, only updates in-memory bundle.
	 */
	writeConcept(
		request: WriteConceptRequest,
		bundlePath?: string,
	): OkfConcept {
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
			links: request.links || extractLinks(request.body),
		};

		const bundle = this.ensureBundle();
		bundle.concepts.push(concept);
		bundle.index = generateIndex(bundle.concepts);

		// Persist to disk if bundlePath is known
		if (bundle.path && bundle.path !== "memory://in-memory" && bundlePath) {
			this._writeConceptToDisk(concept, bundlePath).catch(() => {
				// Non-fatal: in-memory update succeeded
			});
		}

		return concept;
	}

	private async _writeConceptToDisk(
		concept: OkfConcept,
		bundlePath: string,
	): Promise<void> {
		const dir = join(bundlePath, concept.type);
		await mkdir(dir, { recursive: true });

		const slug = slugify(concept.title || concept.id);
		const filePath = join(dir, `${slug}.md`);

		const okfContent = this.exportToOkf(concept);
		await writeFile(filePath, okfContent, "utf-8");
	}

	/**
	 * Promote a concept from the blackboard
	 */
	promoteFromBlackboard(
		blackboardContent: string,
		metadata: Record<string, unknown>,
	): WriteConceptRequest {
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
	 * Rebuild the index from disk and persist index.md to the bundle directory.
	 * If no path is provided, uses the current bundle's path.
	 */
	async rebuildIndex(bundlePath?: string): Promise<void> {
		const targetPath =
			bundlePath ?? this.bundle?.path ?? "memory://in-memory";
		if (targetPath === "memory://in-memory") return;

		await this.loadBundle(targetPath);
		if (this.bundle) {
			this.bundle.index = generateIndex(this.bundle.concepts);
			const indexPath = join(targetPath, "index.md");
			await writeFile(indexPath, this.bundle.index, "utf-8");
		}
	}

	/**
	 * Get the current bundle
	 */
	getBundle(): KnowledgeBundle | null {
		return this.bundle;
	}

	/**
	 * Export a concept to OKF format (RFC-0060).
	 * Strips bundle-level metadata fields (path, index, log, directories)
	 * from the frontmatter to ensure clean round-trip parsing.
	 */
	exportToOkf(concept: OkfConcept): string {
		// Exclude OKF bundle fields and top-level concept fields from metadata
		const reserved = new Set([
			"type",
			"title",
			"description",
			"resource",
			"tags",
			"timestamp",
			"body",
			"links",
			"id",
			"metadata",
			// Bundle-level fields that might leak in
			"path",
			"index",
			"log",
			"directories",
		]);

		// Start with concept top-level fields
		const frontmatter: OkfFrontmatter = {
			type: concept.type,
			title: concept.title,
			tags: concept.tags,
			timestamp: concept.timestamp,
		};

		// Add non-reserved metadata fields
		for (const [key, value] of Object.entries(concept.metadata)) {
			if (!reserved.has(key)) {
				frontmatter[key] = value as string;
			}
		}

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
