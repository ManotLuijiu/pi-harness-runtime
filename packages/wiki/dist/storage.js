/**
 * Wiki Storage - File-based persistence for wiki pages
 *
 * Handles atomic writes, transactions, and consistency.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, readdirSync, } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
// ============================================================================
// Utilities
// ============================================================================
/**
 * Compute SHA-256 hash of content
 */
export function computeHash(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
/**
 * Get current ISO timestamp
 */
export function now() {
    return new Date().toISOString();
}
/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) {
        return { frontmatter: null, body: content, raw: "" };
    }
    const [, yamlStr, body] = match;
    const frontmatter = parseYaml(yamlStr);
    return {
        frontmatter: frontmatter,
        body: body.trim(),
        raw: yamlStr,
    };
}
/**
 * Simple YAML parser for frontmatter
 * Handles: strings, booleans, numbers, arrays, nested objects
 */
function parseYaml(yamlStr) {
    const result = {};
    const lines = yamlStr.split("\n");
    let currentKey = "";
    let currentIndent = 0;
    const stack = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const indent = line.search(/\S/);
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1)
            continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();
        // Pop stack while indent decreases
        while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
            stack.pop();
        }
        const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;
        // Parse value
        if (value === "" || value === "null" || value === "~") {
            value = null;
        }
        else if (value === "true") {
            value = true;
        }
        else if (value === "false") {
            value = false;
        }
        else if (/^-?\d+(\.\d+)?$/.test(value)) {
            value = parseFloat(value);
        }
        else if (value.startsWith("[") && value.endsWith("]")) {
            // Array
            const arrContent = value.slice(1, -1);
            value = arrContent
                ? arrContent.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))
                : [];
        }
        else {
            // String - remove quotes
            value = value.replace(/^["']|["']$/g, "");
        }
        parent[key] = value;
        currentKey = key;
        currentIndent = indent;
    }
    return result;
}
/**
 * Serialize frontmatter to YAML string
 */
export function serializeFrontmatter(frontmatter) {
    const lines = [];
    for (const [key, value] of Object.entries(frontmatter)) {
        if (value === undefined || value === null)
            continue;
        if (Array.isArray(value)) {
            if (value.length === 0) {
                lines.push(`${key}: []`);
            }
            else if (value.every((v) => typeof v === "object")) {
                // Array of objects
                lines.push(`${key}:`);
                for (const item of value) {
                    lines.push(`  - ${JSON.stringify(item)}`);
                }
            }
            else {
                lines.push(`${key}: [${value.join(", ")}]`);
            }
        }
        else if (typeof value === "object") {
            // Nested object
            lines.push(`${key}:`);
            for (const [k, v] of Object.entries(value)) {
                lines.push(`  ${k}: ${JSON.stringify(v)}`);
            }
        }
        else if (typeof value === "boolean" || typeof value === "number") {
            lines.push(`${key}: ${value}`);
        }
        else {
            // String - quote if needed
            const str = String(value);
            if (str.includes(":") || str.includes("#") || str.includes("\n")) {
                lines.push(`${key}: "${str.replace(/"/g, '\\"')}"`);
            }
            else {
                lines.push(`${key}: ${str}`);
            }
        }
    }
    return lines.join("\n");
}
/**
 * Combine frontmatter and body into full page content
 */
export function combinePage(frontmatter, body) {
    return `---\n${serializeFrontmatter(frontmatter)}\n---\n\n${body}`;
}
// ============================================================================
// Storage Implementation
// ============================================================================
/**
 * Wiki storage manager
 */
export class WikiStorage {
    config;
    index = new Map();
    operations = [];
    stagedChanges = new Map();
    dirty = false;
    constructor(config) {
        this.config = config;
        this.ensureStructure();
        this.loadIndex();
        this.loadOperations();
        this.loadStaged();
    }
    /**
     * Get wiki configuration
     */
    getConfig() {
        return this.config;
    }
    /**
     * Initialize wiki structure
     */
    initialize() {
        const existing = existsSync(this.config.wikiRoot);
        if (!existing) {
            mkdirSync(this.config.wikiRoot, { recursive: true });
        }
        // Create subdirectories
        for (const dir of [
            this.config.rawDir,
            this.config.knowledgeDir,
            this.config.harnessDir,
        ]) {
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
        }
        // Create schema file if not exists
        if (!existsSync(this.config.schemaFile)) {
            writeFileSync(this.config.schemaFile, `# Wiki Maintenance Conventions

## Page Structure

Every wiki page must have:

\`\`\`yaml
---
id: <uuid>
title: <human-readable title>
kind: <concept|decision|incident|plan|verification|reference>
projectId: <canonical project identifier>
status: <proposed|implemented|verified|stale|superseded>
createdAt: <ISO timestamp>
updatedAt: <ISO timestamp>
sources: []
relatedPages: []
---
\`\`\`

## Status Lifecycle

- \`proposed\`: Awaiting synthesis/verification
- \`implemented\`: Applied but not yet verified
- \`verified\`: Test/inspection evidence recorded
- \`stale\`: Source changed, needs review
- \`superseded\`: Replaced by another page

## Source References

Always cite immutable snapshots, never live files:

\`\`\`yaml
sources:
  - sourceId: <snapshot-id>
    path: <original path>
    contentHash: <sha256>
    capturedAt: <ISO timestamp>
    redacted: <true|false>
\`\`\`

## Verification

A page is \`verified\` only with recorded evidence:

\`\`\`yaml
verification:
  evidence: <test name or inspection reference>
  scope: <what was verified>
  version: <code version>
\`\`\`
`, "utf8");
        }
        return {
            created: !existing,
            existing,
            config: this.config,
        };
    }
    /**
     * Ensure directory structure exists
     */
    ensureStructure() {
        if (!existsSync(this.config.wikiRoot)) {
            mkdirSync(this.config.wikiRoot, { recursive: true });
        }
    }
    /**
     * Load page index from disk
     */
    loadIndex() {
        this.index.clear();
        if (!existsSync(this.config.indexFile))
            return;
        try {
            const content = readFileSync(this.config.indexFile, "utf8");
            const entries = JSON.parse(content);
            for (const entry of entries) {
                this.index.set(entry.id, entry);
            }
        }
        catch {
            // Invalid index, rebuild
        }
    }
    /**
     * Save page index to disk (atomic)
     */
    saveIndex() {
        const entries = Array.from(this.index.values());
        const content = JSON.stringify(entries, null, 2);
        const tmpFile = this.config.indexFile + ".tmp";
        writeFileSync(tmpFile, content, "utf8");
        renameSync(tmpFile, this.config.indexFile);
        this.dirty = false;
    }
    /**
     * Load operations from log
     */
    loadOperations() {
        this.operations = [];
        if (!existsSync(this.config.logFile))
            return;
        try {
            const content = readFileSync(this.config.logFile, "utf8");
            const lines = content.split("\n").filter((l) => l.trim());
            for (const line of lines) {
                try {
                    this.operations.push(JSON.parse(line));
                }
                catch {
                    // Skip invalid lines
                }
            }
        }
        catch {
            // No log yet
        }
    }
    /**
     * Append operation to log
     */
    appendOperation(op) {
        const line = JSON.stringify(op) + "\n";
        writeFileSync(this.config.logFile, line, { flag: "a", encoding: "utf8" });
        this.operations.push(op);
    }
    /**
     * Load staged changes
     */
    loadStaged() {
        this.stagedChanges.clear();
        const stagedFile = join(this.config.harnessDir, "staged.json");
        if (!existsSync(stagedFile))
            return;
        try {
            const content = readFileSync(stagedFile, "utf8");
            const changes = JSON.parse(content);
            for (const change of changes) {
                this.stagedChanges.set(change.pageId, change);
            }
        }
        catch {
            // Invalid staged file
        }
    }
    /**
     * Save staged changes (atomic)
     */
    saveStaged() {
        const changes = Array.from(this.stagedChanges.values());
        const stagedFile = join(this.config.harnessDir, "staged.json");
        const content = JSON.stringify(changes, null, 2);
        const tmpFile = stagedFile + ".tmp";
        writeFileSync(tmpFile, content, "utf8");
        renameSync(tmpFile, stagedFile);
    }
    // ========================================================================
    // Source Snapshot Operations
    // ========================================================================
    /**
     * Create immutable source snapshot
     */
    createSnapshot(originalPath, content, operationId) {
        const id = `snap-${randomUUID().slice(0, 8)}`;
        const snapshot = {
            id,
            originalPath,
            contentHash: computeHash(content),
            capturedAt: now(),
            content,
            redacted: false,
            operationId,
        };
        // Save snapshot file
        const snapFile = join(this.config.rawDir, `${id}.json`);
        writeFileSync(snapFile, JSON.stringify(snapshot, null, 2), "utf8");
        return snapshot;
    }
    /**
     * Get source snapshot by ID
     */
    getSnapshot(snapshotId) {
        const snapFile = join(this.config.rawDir, `${snapshotId}.json`);
        if (!existsSync(snapFile))
            return null;
        try {
            const content = readFileSync(snapFile, "utf8");
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    // ========================================================================
    // Page Operations
    // ========================================================================
    /**
     * Save a wiki page
     */
    savePage(page) {
        const content = combinePage(page.frontmatter, page.body);
        const pageFile = join(this.config.knowledgeDir, `${page.frontmatter.id}.md`);
        const tmpFile = pageFile + ".tmp";
        writeFileSync(tmpFile, content, "utf8");
        renameSync(tmpFile, pageFile);
        // Update index
        const entry = {
            id: page.frontmatter.id,
            title: page.frontmatter.title,
            kind: page.frontmatter.kind,
            status: page.frontmatter.status,
            tags: [], // Extracted from body
            summary: page.body.slice(0, 200),
            updatedAt: page.frontmatter.updatedAt,
            codeVersion: page.frontmatter.codeVersion,
        };
        this.index.set(entry.id, entry);
        this.saveIndex();
        this.dirty = true;
    }
    /**
     * Load a wiki page
     */
    loadPage(pageId) {
        const pageFile = join(this.config.knowledgeDir, `${pageId}.md`);
        if (!existsSync(pageFile))
            return null;
        const content = readFileSync(pageFile, "utf8");
        const { frontmatter, body, raw } = parseFrontmatter(content);
        if (!frontmatter)
            return null;
        return { frontmatter, body, rawFrontmatter: raw };
    }
    /**
     * Delete a wiki page
     */
    deletePage(pageId) {
        const pageFile = join(this.config.knowledgeDir, `${pageId}.md`);
        if (existsSync(pageFile)) {
            unlinkSync(pageFile);
        }
        this.index.delete(pageId);
        this.saveIndex();
        this.stagedChanges.delete(pageId);
        this.saveStaged();
    }
    /**
     * Get all pages
     */
    getAllPages() {
        const pages = [];
        if (!existsSync(this.config.knowledgeDir))
            return pages;
        const files = readdirSync(this.config.knowledgeDir);
        for (const file of files) {
            if (!file.endsWith(".md"))
                continue;
            const pageId = file.replace(".md", "");
            const page = this.loadPage(pageId);
            if (page)
                pages.push(page);
        }
        return pages;
    }
    // ========================================================================
    // Staged Changes Operations
    // ========================================================================
    /**
     * Stage a change for later application
     */
    stageChange(change) {
        this.stagedChanges.set(change.pageId, change);
        this.saveStaged();
    }
    /**
     * Get staged change for a page
     */
    getStagedChange(pageId) {
        return this.stagedChanges.get(pageId);
    }
    /**
     * Clear staged change
     */
    clearStagedChange(pageId) {
        this.stagedChanges.delete(pageId);
        this.saveStaged();
    }
    /**
     * Get all staged changes
     */
    getAllStagedChanges() {
        return Array.from(this.stagedChanges.values());
    }
    // ========================================================================
    // Operation Logging
    // ========================================================================
    /**
     * Log an operation
     */
    logOperation(type, details, requestId) {
        const op = {
            id: `op-${randomUUID().slice(0, 8)}`,
            type,
            status: "pending",
            startedAt: now(),
            requestId,
            details,
        };
        this.appendOperation(op);
        return op;
    }
    /**
     * Update operation status
     */
    completeOperation(opId, status, error) {
        const opIndex = this.operations.findIndex((o) => o.id === opId);
        if (opIndex === -1)
            return;
        this.operations[opIndex] = {
            ...this.operations[opIndex],
            status,
            completedAt: now(),
            error,
        };
        // Rewrite log with updated operation
        const tmpFile = this.config.logFile + ".tmp";
        const content = this.operations.map((o) => JSON.stringify(o)).join("\n") + "\n";
        writeFileSync(tmpFile, content, "utf8");
        renameSync(tmpFile, this.config.logFile);
    }
    /**
     * Get recent operations
     */
    getRecentOperations(limit = 50) {
        return this.operations.slice(-limit);
    }
    // ========================================================================
    // Search
    // ========================================================================
    /**
     * Search wiki pages
     */
    search(query, filters, limit = 10) {
        const queryLower = query.toLowerCase();
        const results = [];
        for (const [id, entry] of this.index) {
            // Apply filters
            if (filters?.kinds?.length && !filters.kinds.includes(entry.kind))
                continue;
            if (filters?.statuses?.length && !filters.statuses.includes(entry.status))
                continue;
            if (filters?.updatedAfter && entry.updatedAt < filters.updatedAfter)
                continue;
            if (filters?.updatedBefore && entry.updatedAt > filters.updatedBefore)
                continue;
            // Calculate relevance
            let relevance = 0;
            const matchedOn = [];
            if (entry.title.toLowerCase().includes(queryLower)) {
                relevance += 0.5;
                matchedOn.push("title");
            }
            if (entry.summary.toLowerCase().includes(queryLower)) {
                relevance += 0.3;
                matchedOn.push("body");
            }
            if (entry.tags.some((t) => t.toLowerCase().includes(queryLower))) {
                relevance += 0.2;
                matchedOn.push("tags");
            }
            if (relevance > 0) {
                results.push({
                    page: entry,
                    relevance,
                    matchedOn,
                    snippets: [entry.summary],
                });
            }
        }
        // Sort by relevance and limit
        results.sort((a, b) => b.relevance - a.relevance);
        return results.slice(0, limit);
    }
    /**
     * Get page index
     */
    getIndex() {
        return Array.from(this.index.values());
    }
}
// ============================================================================
// Factory
// ============================================================================
/**
 * Create wiki storage for a workspace
 */
export function createWikiStorage(workspaceRoot, projectId) {
    const wikiRoot = join(workspaceRoot, "wiki");
    const config = {
        wikiRoot,
        rawDir: join(wikiRoot, "raw"),
        knowledgeDir: join(wikiRoot, "knowledge"),
        harnessDir: join(wikiRoot, ".harness"),
        indexFile: join(wikiRoot, ".harness", "index.json"),
        logFile: join(wikiRoot, ".harness", "log.jsonl"),
        schemaFile: join(wikiRoot, "SCHEMA.md"),
        projectId,
    };
    return new WikiStorage(config);
}
//# sourceMappingURL=storage.js.map