/**
 * Wiki Storage - File-based persistence for wiki pages
 *
 * Handles atomic writes, transactions, and consistency.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, readdirSync, statSync, lstatSync, } from "node:fs";
import { join, dirname, resolve } from "node:path";
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
        // SAFETY: parseYaml returns Record<string, unknown>, cast through unknown to satisfy TS
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        frontmatter: frontmatter,
        body: body.trim(),
        raw: yamlStr,
    };
}
/**
 * Simple YAML parser for frontmatter
 * Handles: strings, booleans, numbers, arrays, nested objects, YAML list items
 */
function parseYaml(yamlStr) {
    const result = {};
    const lines = yamlStr.split("\n");
    const stack = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const indent = line.search(/\S/);
        // Handle YAML list items (lines starting with '-')
        if (trimmed.startsWith("-")) {
            const itemContent = trimmed.slice(1).trim();
            const colonIdx = itemContent.indexOf(":");
            if (colonIdx !== -1) {
                // This is a list item with key-value pairs on same line or next lines
                const key = itemContent.slice(0, colonIdx).trim();
                const value = itemContent.slice(colonIdx + 1).trim();
                // Pop stack while indent decreases
                while (stack.length > 0 && indent < stack[stack.length - 1].indent) {
                    stack.pop();
                }
                // Find or create the array
                const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;
                const arrayKey = parent ? Object.keys(parent).slice(-1)[0] : undefined;
                let array;
                if (arrayKey && Array.isArray(parent[arrayKey])) {
                    array = parent[arrayKey];
                }
                else {
                    // Start a new array
                    const newArray = [];
                    if (parent) {
                        parent[arrayKey || key] = newArray;
                    }
                    else {
                        result[key] = newArray;
                    }
                    array = newArray;
                }
                // Create new object for this list item
                const item = {};
                array.push(item);
                // Parse the key-value on this line
                const parsedValue = parseValue(value);
                if (parsedValue !== undefined) {
                    item[key] = parsedValue;
                }
                // Push this item to stack for nested properties
                stack.push({ obj: item, indent });
            }
            continue;
        }
        // Regular key-value line
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1)
            continue;
        const key = trimmed.slice(0, colonIdx).trim();
        const rawValue = trimmed.slice(colonIdx + 1).trim();
        // Pop stack while indent decreases
        while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
            stack.pop();
        }
        const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;
        // Check if value is empty (nested content follows)
        if (rawValue === "" || rawValue === "~" || rawValue === "null") {
            // Nested content follows - create placeholder
            const nested = {};
            parent[key] = nested;
            stack.push({ obj: nested, indent });
            continue;
        }
        parent[key] = parseValue(rawValue);
    }
    return result;
}
function parseValue(value) {
    if (value === "" || value === "null" || value === "~") {
        return null;
    }
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) {
        return parseFloat(value);
    }
    // Handle JSON-serialized values (objects and arrays)
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
            return JSON.parse(trimmed);
        }
        catch {
            // Fall through to string parsing
        }
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        const content = trimmed.slice(1, -1);
        return content ? content.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")) : [];
    }
    return trimmed.replace(/^["']|["']$/g, "");
}
/**
 * Serialize frontmatter to YAML string
 */
export function serializeFrontmatter(frontmatter) {
    const lines = [];
    for (const [key, value] of Object.entries(frontmatter)) {
        if (value === undefined || value === null)
            continue;
        // Special handling for sources and verification - use JSON for reliability
        if ((key === "sources" || key === "verification") && (Array.isArray(value) || typeof value === "object")) {
            lines.push(`${key}: ${JSON.stringify(value)}`);
            continue;
        }
        if (Array.isArray(value)) {
            if (value.length === 0) {
                lines.push(`${key}: []`);
            }
            else {
                lines.push(`${key}: [${value.join(", ")}]`);
            }
        }
        else if (typeof value === "object") {
            // Nested object - use JSON
            lines.push(`${key}: ${JSON.stringify(value)}`);
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
    indexMtime = 0; // Track when index was last loaded
    operations = [];
    stagedChanges = new Map();
    initialized = false;
    // Track explicitly modified entries to prevent stale data overwrites
    modifiedIds = new Set();
    // Track explicitly deleted IDs to prevent resurrecting deletions
    deletedIds = new Set();
    constructor(config) {
        this.config = config;
        // Don't create directories until explicitly initialized
        // This prevents writes when the feature is disabled
    }
    /**
     * Initialize storage (call before any read/write operations)
     * This is called automatically by WikiManager when feature is enabled
     */
    initializeStorage() {
        if (this.initialized)
            return;
        this.loadIndex();
        this.loadOperations();
        this.loadStaged();
        this.initialized = true;
    }
    /**
     * Check if storage is initialized
     */
    isInitialized() {
        return this.initialized;
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
        // Initialize storage for reads/writes
        this.initializeStorage();
        return {
            created: !existing,
            existing,
            config: this.config,
        };
    }
    /**
     * Load page index from disk (if changed since last load)
     */
    loadIndex(force = false) {
        if (!force) {
            try {
                const stat = statSync(this.config.indexFile);
                // Only reload if file was modified since last load
                if (stat.mtimeMs <= this.indexMtime) {
                    return;
                }
            }
            catch {
                // File doesn't exist or can't be stat'd
            }
        }
        this.index.clear();
        if (!existsSync(this.config.indexFile)) {
            this.indexMtime = 0;
            return;
        }
        try {
            const content = readFileSync(this.config.indexFile, "utf8");
            const entries = JSON.parse(content);
            for (const entry of entries) {
                this.index.set(entry.id, entry);
            }
            const stat = statSync(this.config.indexFile);
            this.indexMtime = stat.mtimeMs;
        }
        catch {
            // Invalid index, rebuild
            this.indexMtime = 0;
        }
    }
    /**
     * Save page index to disk (atomic)
     * Only applies changes from this manager instance (tracked via modifiedIds)
     * Respects deletions tracked via deletedIds
     */
    saveIndex() {
        // Load current disk state
        const diskEntries = this.loadIndexFromDisk();
        const merged = new Map();
        // Start with disk entries, filtering out deleted ones
        for (const [id, entry] of diskEntries) {
            // Skip if explicitly deleted by this manager
            if (this.deletedIds.has(id)) {
                continue;
            }
            // Skip if page file no longer exists
            const pageFile = join(this.config.knowledgeDir, `${id}.md`);
            if (!existsSync(pageFile)) {
                continue;
            }
            // Keep disk entry unless this manager modified it
            if (!this.modifiedIds.has(id)) {
                merged.set(id, entry);
            }
        }
        // Apply only this manager's modifications
        for (const id of this.modifiedIds) {
            const entry = this.index.get(id);
            if (entry) {
                merged.set(id, entry);
            }
        }
        const entries = Array.from(merged.values());
        const content = JSON.stringify(entries, null, 2);
        const tmpFile = this.config.indexFile + ".tmp";
        // Validate temp path for symlink containment
        this.ensureWithinDirectory(tmpFile, this.config.harnessDir);
        writeFileSync(tmpFile, content, "utf8");
        renameSync(tmpFile, this.config.indexFile);
        // Clear successfully persisted mutations
        this.modifiedIds.clear();
        this.deletedIds.clear();
    }
    /**
     * Load index from disk only (no cache)
     */
    loadIndexFromDisk() {
        const result = new Map();
        if (!existsSync(this.config.indexFile))
            return result;
        try {
            const content = readFileSync(this.config.indexFile, "utf8");
            const entries = JSON.parse(content);
            for (const entry of entries) {
                result.set(entry.id, entry);
            }
        }
        catch {
            // Invalid index, return empty
        }
        return result;
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
        this.validateSnapshotId(snapshotId);
        const snapFile = join(this.config.rawDir, `${snapshotId}.json`);
        this.ensureWithinDirectory(snapFile, this.config.rawDir);
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
        this.validatePageId(page.frontmatter.id);
        const content = combinePage(page.frontmatter, page.body);
        const pageFile = join(this.config.knowledgeDir, `${page.frontmatter.id}.md`);
        this.ensureWithinDirectory(pageFile, this.config.knowledgeDir);
        // Validate temp path to prevent symlink bypass
        const tmpFile = pageFile + ".tmp";
        this.ensureWithinDirectory(tmpFile, this.config.knowledgeDir);
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
        // Track this entry as modified so saveIndex applies it
        this.modifiedIds.add(entry.id);
        // Clear from deleted set if it was previously deleted
        this.deletedIds.delete(entry.id);
        this.saveIndex();
    }
    /**
     * Load a wiki page
     */
    loadPage(pageId) {
        this.validatePageId(pageId);
        const pageFile = join(this.config.knowledgeDir, `${pageId}.md`);
        this.ensureWithinDirectory(pageFile, this.config.knowledgeDir);
        if (!existsSync(pageFile))
            return null;
        const content = readFileSync(pageFile, "utf8");
        const { frontmatter, body, raw } = parseFrontmatter(content);
        if (!frontmatter)
            return null;
        return { frontmatter, body, rawFrontmatter: raw };
    }
    /**
     * Validate page ID to prevent path traversal attacks
     */
    validatePageId(pageId) {
        // Reject paths with directory separators or parent references
        if (pageId.includes("/") || pageId.includes("\\") || pageId.includes("..")) {
            throw new Error(`Invalid page ID: ${pageId}`);
        }
    }
    /**
     * Validate snapshot ID to prevent path traversal attacks
     */
    validateSnapshotId(snapshotId) {
        // Reject paths with directory separators or parent references
        if (snapshotId.includes("/") || snapshotId.includes("\\") || snapshotId.includes("..")) {
            throw new Error(`Invalid snapshot ID: ${snapshotId}`);
        }
    }
    /**
     * Check if a path or any of its parent directories is a symlink
     */
    hasSymlinkComponent(filePath) {
        let current = filePath;
        while (current !== "/" && current !== "") {
            try {
                const stat = lstatSync(current);
                if (stat.isSymbolicLink()) {
                    return true;
                }
            }
            catch {
                // File doesn't exist or can't be stat'd
            }
            const parent = dirname(current);
            if (parent === current)
                break; // Reached root
            current = parent;
        }
        return false;
    }
    /**
     * Ensure a path is within the expected directory (defense in depth)
     */
    ensureWithinDirectory(filePath, expectedDir) {
        // Reject symlinks to prevent path escape via symlink traversal
        if (this.hasSymlinkComponent(filePath)) {
            throw new Error(`Path ${filePath} contains a symlink component`);
        }
        // Also check the expected directory itself
        if (this.hasSymlinkComponent(expectedDir)) {
            throw new Error(`Expected directory ${expectedDir} contains a symlink`);
        }
        const resolved = resolve(filePath);
        const expected = resolve(expectedDir);
        if (!resolved.startsWith(expected + "/") && resolved !== expected) {
            throw new Error(`Path ${filePath} is outside expected directory ${expectedDir}`);
        }
    }
    /**
     * Delete a wiki page
     */
    deletePage(pageId) {
        this.validatePageId(pageId);
        const pageFile = join(this.config.knowledgeDir, `${pageId}.md`);
        if (existsSync(pageFile)) {
            unlinkSync(pageFile);
        }
        this.index.delete(pageId);
        // Track this ID as deleted so saveIndex excludes it
        this.deletedIds.add(pageId);
        this.modifiedIds.delete(pageId);
        this.saveIndex();
        this.stagedChanges.delete(pageId);
        this.saveStaged();
    }
    /**
     * Get all pages
     */
    getAllPages() {
        // Reload index to get latest changes from other processes
        this.loadIndex();
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
        // Reload staged changes to get latest from other processes
        this.loadStaged();
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
     * Update operation details (before completion)
     */
    updateOperationDetails(opId, details) {
        const opIndex = this.operations.findIndex((o) => o.id === opId);
        if (opIndex === -1)
            return;
        this.operations[opIndex] = {
            ...this.operations[opIndex],
            details: { ...this.operations[opIndex].details, ...details },
        };
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
        for (const [_id, entry] of this.index) {
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