/**
 * Memory Engine (RFC-0060)
 *
 * Manages durable knowledge using Google's Open Knowledge Format (OKF).
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { RESERVED_FILES } from "./types.js";
import { filterSecrets, AUTHORITY_PRIORITY } from "./types.js";
// ─── YAML Frontmatter Parsing ─────────────────────────────────────────────────
function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
        return null;
    }
    const [, yamlStr, body] = match;
    const frontmatter = { type: "" };
    const lines = yamlStr.split("\n");
    for (const line of lines) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (value.startsWith("[") && value.endsWith("]")) {
            // Array
            frontmatter[key] = value
                .slice(1, -1)
                .split(",")
                .map((s) => s.trim());
        }
        else if (value === "true") {
            frontmatter[key] = true;
        }
        else if (value === "false") {
            frontmatter[key] = false;
        }
        else {
            frontmatter[key] = value.replace(/^["']|["']$/g, "");
        }
    }
    return { frontmatter, body: body.trim(), raw: yamlStr };
}
function serializeFrontmatter(data) {
    const lines = [];
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null)
            continue;
        if (Array.isArray(value)) {
            lines.push(`${key}: [${value.join(", ")}]`);
        }
        else if (typeof value === "boolean") {
            lines.push(`${key}: ${value}`);
        }
        else if (typeof value === "object") {
            lines.push(`${key}: ${JSON.stringify(value)}`);
        }
        else {
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
export function extractLinks(markdown) {
    const links = [];
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
export function validateConcept(content, path) {
    const errors = [];
    const warnings = [];
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
function generateIndex(concepts) {
    const lines = [
        "# Knowledge Index",
        "",
        `Last updated: ${new Date().toISOString()}`,
        "",
        "## By Type",
        "",
    ];
    // Group by type
    const byType = new Map();
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
    const byTag = new Map();
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
function calculateRelevance(concept, query) {
    let score = 0;
    const matchedOn = [];
    // Title match
    if (query.text &&
        concept.title?.toLowerCase().includes(query.text.toLowerCase())) {
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
    const authority = concept.metadata?.authority || "unverified";
    if (query.authority && query.authority.includes(authority)) {
        score += 10 * AUTHORITY_PRIORITY[authority];
        matchedOn.push("authority");
    }
    // Body match
    if (query.text &&
        concept.body.toLowerCase().includes(query.text.toLowerCase())) {
        score += 5;
    }
    return score;
}
// ─── Main Engine ─────────────────────────────────────────────────────────────
export class MemoryEngine {
    bundle = null;
    ensureBundle() {
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
     * Recursively reads all .md files, parses frontmatter + body,
     * and builds the in-memory concept index.
     */
    async loadBundle(bundlePath) {
        const concepts = [];
        const directories = [];
        // Walk directory recursively for .md files
        async function walkDir(dir) {
            let entries;
            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            }
            catch {
                return; // Ignore missing directories
            }
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
                        directories.push({
                            path: path.relative(bundlePath, fullPath),
                            name: entry.name,
                            files: [],
                            subdirectories: [],
                        });
                        await walkDir(fullPath);
                    }
                }
                else if (entry.name.endsWith(".md") &&
                    !RESERVED_FILES.includes(entry.name)) {
                    const content = await fs.readFile(fullPath, "utf-8").catch(() => "");
                    const parsed = parseFrontmatter(content);
                    if (parsed && parsed.frontmatter.type) {
                        const id = path.relative(bundlePath, fullPath).replace(/\.md$/, "");
                        concepts.push({
                            id,
                            type: parsed.frontmatter.type,
                            title: parsed.frontmatter.title,
                            description: parsed.frontmatter.description,
                            resource: parsed.frontmatter.resource,
                            tags: parsed.frontmatter.tags || [],
                            timestamp: parsed.frontmatter.timestamp,
                            metadata: { ...parsed.frontmatter },
                            body: parsed.body,
                            links: extractLinks(parsed.body),
                        });
                        // Prune OKF-reserved fields from metadata (they are top-level on OkfConcept)
                        delete concepts[concepts.length - 1].metadata["type"];
                        delete concepts[concepts.length - 1].metadata["title"];
                        delete concepts[concepts.length - 1].metadata["tags"];
                        delete concepts[concepts.length - 1].metadata["timestamp"];
                    }
                }
            }
        }
        await walkDir(bundlePath);
        const bundle = {
            path: bundlePath,
            concepts,
            index: "",
            log: "",
            directories,
        };
        // Load reserved files: index.md and log.md
        const [indexPath, logPath] = ["index.md", "log.md"].map((f) => path.join(bundlePath, f));
        try {
            bundle.index = await fs.readFile(indexPath, "utf-8");
        }
        catch {
            // No index yet — generate fresh
            bundle.index = generateIndex(concepts);
        }
        try {
            bundle.log = await fs.readFile(logPath, "utf-8");
        }
        catch {
            // No log yet — that's fine
        }
        this.bundle = bundle;
        return bundle;
    }
    /**
     * Validate a bundle
     */
    validateBundle(bundle) {
        const errors = [];
        const warnings = [];
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
    search(query) {
        const bundle = this.ensureBundle();
        const results = [];
        for (const concept of bundle.concepts) {
            // Filter by authority
            if (query.authority) {
                const authority = concept.metadata?.authority || "unverified";
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
     * Write a new concept (RFC-0060)
     *
     * Persists to disk at {bundle.path}/{id}.md and updates bundle index.
     * File name is derived from the title slug (first 64 chars).
     */
    async writeConcept(request) {
        const id = request.title
            ? request.title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 64) +
                "-" +
                randomUUID().slice(0, 8)
            : randomUUID();
        const timestamp = new Date().toISOString();
        const concept = {
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
        // Persist to disk
        if (bundle.path && bundle.path !== "memory://in-memory") {
            const filePath = path.join(bundle.path, `${id}.md`);
            const okfContent = this.exportToOkf(concept);
            await fs.mkdir(bundle.path, { recursive: true });
            await fs.writeFile(filePath, okfContent, "utf-8");
        }
        bundle.concepts.push(concept);
        bundle.index = generateIndex(bundle.concepts);
        return concept;
    }
    /**
     * Promote a concept from the blackboard
     */
    promoteFromBlackboard(blackboardContent, metadata) {
        // Filter secrets before promoting
        const filteredContent = filterSecrets(blackboardContent);
        return {
            type: metadata.type || "knowledge",
            title: metadata.title,
            body: filteredContent,
            tags: metadata.tags || [],
            authority: metadata.authority || "unverified",
            metadata,
        };
    }
    /**
     * Rebuild the index from disk and persist index.md to bundle directory.
     */
    async rebuildIndex(bundlePath) {
        const targetPath = bundlePath ?? this.bundle?.path;
        if (!targetPath || targetPath === "memory://in-memory") {
            if (this.bundle) {
                this.bundle.index = generateIndex(this.bundle.concepts);
            }
            return;
        }
        if (!this.bundle || this.bundle.path !== targetPath) {
            await this.loadBundle(targetPath);
        }
        if (this.bundle) {
            this.bundle.index = generateIndex(this.bundle.concepts);
            const indexPath = path.join(targetPath, "index.md");
            await fs.writeFile(indexPath, this.bundle.index, "utf-8");
        }
    }
    /**
     * Get the current bundle
     */
    getBundle() {
        return this.bundle;
    }
    /**
     * Export a concept to OKF format (RFC-0060)
     *
     * Excludes bundle-level metadata fields (index, log, directories)
     * from the concept frontmatter to ensure clean round-trip parsing.
     */
    exportToOkf(concept) {
        // Collect concept-level metadata only, excluding top-level OKF fields
        // and any bundle-level reserved fields that might be present.
        const reserved = new Set([
            "id",
            "type",
            "title",
            "description",
            "resource",
            "tags",
            "timestamp",
            "body",
            "links",
            "index",
            "log",
            "directories",
        ]);
        const conceptMetadata = {};
        const meta = concept.metadata ?? {};
        for (const [k, v] of Object.entries(meta)) {
            if (!reserved.has(k)) {
                conceptMetadata[k] = v;
            }
        }
        const lines = [
            "---",
            serializeFrontmatter({
                type: concept.type,
                title: concept.title,
                tags: concept.tags,
                timestamp: concept.timestamp,
                ...conceptMetadata,
            }),
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
export function createMemoryEngine() {
    return new MemoryEngine();
}
//# sourceMappingURL=engine.js.map