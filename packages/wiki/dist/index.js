/**
 * Wiki Package - Main API
 *
 * Implements LLM Wiki integration per wiki/llm-wiki-integration-minimax-plan.md
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, isAbsolute, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { createWikiStorage, computeHash, now, parseFrontmatter, } from "./storage.js";
import { toSourceRef } from "./types.js";
// ============================================================================
// Feature Flag
// ============================================================================
/**
 * Check if wiki feature is enabled
 */
export function isWikiEnabled() {
    return process.env.HARNESS_KNOWLEDGE_WIKI === "1";
}
/**
 * Require wiki to be enabled and ensure storage is initialized
 */
function requireWiki(storage) {
    if (!isWikiEnabled()) {
        throw new Error("Wiki feature is disabled. Set HARNESS_KNOWLEDGE_WIKI=1 to enable.");
    }
    // Lazy initialization: ensure storage is ready on first use
    if (!storage.isInitialized()) {
        storage.initialize();
    }
}
// ============================================================================
// Wiki Manager
// ============================================================================
/**
 * Wiki manager - main API for wiki operations
 */
export class WikiManager {
    storage;
    config;
    constructor(storage) {
        this.storage = storage;
        this.config = storage.getConfig();
    }
    /**
     * Get wiki configuration
     */
    getConfig() {
        return this.config;
    }
    // ========================================================================
    // Initialization
    // ========================================================================
    /**
     * Initialize wiki structure
     */
    initialize() {
        // Check if feature is enabled
        if (!isWikiEnabled()) {
            throw new Error("Wiki feature is disabled. Set HARNESS_KNOWLEDGE_WIKI=1 to enable.");
        }
        requireWiki(this.storage);
        return this.storage.initialize();
    }
    /**
     * Check if wiki is initialized
     */
    isInitialized() {
        return existsSync(this.config.knowledgeDir);
    }
    // ========================================================================
    // Source Ingestion
    // ========================================================================
    /**
     * Ingest a source file and create snapshot
     * Returns existing snapshot if same requestId was already processed
     */
    ingestSource(sourcePath, requestId) {
        requireWiki(this.storage);
        // Validate source path
        // Resolve relative paths against wiki root (workspace), not process cwd
        let resolvedPath;
        if (isAbsolute(sourcePath)) {
            resolvedPath = sourcePath;
        }
        else {
            resolvedPath = resolve(this.config.wikiRoot, sourcePath);
        }
        if (!existsSync(resolvedPath)) {
            throw new Error(`Source file not found: ${sourcePath}`);
        }
        // Check for duplicate request
        if (requestId) {
            const operations = this.storage.getRecentOperations(1000);
            const existingOp = operations.find((op) => op.requestId === requestId && op.status === "success");
            if (existingOp) {
                const details = existingOp.details;
                // Check if the source path matches (same requestId for different source = conflict)
                // Compare resolved paths to handle relative vs absolute path variations
                if (details.resolvedPath && details.resolvedPath !== resolvedPath) {
                    throw new Error(`Request ID ${requestId} was already used for a different source path. ` +
                        `Original: ${details.resolvedPath}, Requested: ${resolvedPath}`);
                }
                if (details.snapshotId) {
                    const snapshot = this.storage.getSnapshot(details.snapshotId);
                    if (snapshot) {
                        return { snapshot, operation: existingOp, existing: true };
                    }
                }
            }
        }
        // Read content
        const content = readFileSync(resolvedPath, "utf8");
        // Log operation
        const operation = this.storage.logOperation("ingest", { sourcePath, resolvedPath }, requestId);
        try {
            // Create snapshot
            const snapshot = this.storage.createSnapshot(resolvedPath, content, operation.id);
            // Update operation with snapshot ID for future deduplication
            this.storage.updateOperationDetails(operation.id, { snapshotId: snapshot.id });
            // Complete operation
            this.storage.completeOperation(operation.id, "success");
            return { snapshot, operation, existing: false };
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            this.storage.completeOperation(operation.id, "failed", error);
            throw err;
        }
    }
    /**
     * Ingest a source and create a wiki page from it
     * Combines snapshot capture with page creation for searchable knowledge
     */
    ingestAndCreatePage(sourcePath, requestId) {
        const { snapshot, operation, existing } = this.ingestSource(sourcePath, requestId);
        // If page already existed for this source, return it
        if (existing) {
            // Try to find existing page that cites this snapshot
            const pages = this.getAllPages();
            const existingPage = pages.find(p => p.frontmatter.sources.some(s => s.sourceId === snapshot.id));
            if (existingPage) {
                return { page: existingPage, snapshot, operation, existing: true };
            }
        }
        // Create a page from the snapshot
        // Title derived from source filename
        const title = basename(sourcePath, extname(sourcePath))
            .replace(/[-_]/g, " ")
            .replace(/([a-z])([A-Z])/g, "$1 $2");
        // Simple faux synthesis: summary from content
        const body = this.synthesizePageBody(snapshot);
        const page = this.createPage({
            title,
            kind: "reference",
            body,
            sources: [snapshot],
        });
        return { page, snapshot, operation, existing: false };
    }
    /**
     * Synthesize page body from source snapshot (faux synthesis for now)
     */
    synthesizePageBody(snapshot) {
        // Extract first meaningful lines as summary
        const lines = snapshot.content.split("\n").filter(l => {
            const trimmed = l.trim();
            return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("#") && trimmed.length > 20;
        });
        const summary = lines.slice(0, 5).join("\n");
        return `# ${snapshot.originalPath}

Source: ${snapshot.originalPath}
Captured: ${snapshot.capturedAt}

## Summary

${summary || "(No extractable content)"}

## Notes

This page was auto-generated from the ingested source. Edit to add analysis and context.
`;
    }
    /**
     * Get source snapshot
     */
    getSnapshot(snapshotId) {
        requireWiki(this.storage);
        return this.storage.getSnapshot(snapshotId);
    }
    // ========================================================================
    // Page Operations
    // ========================================================================
    /**
     * Create a new wiki page
     */
    createPage(params) {
        requireWiki(this.storage);
        const id = `page-${randomUUID().slice(0, 8)}`;
        const timestamp = now();
        const frontmatter = {
            id,
            title: params.title,
            kind: params.kind,
            projectId: this.config.projectId,
            status: "proposed",
            createdAt: timestamp,
            updatedAt: timestamp,
            sources: (params.sources ?? []).map(toSourceRef),
            relatedPages: params.relatedPages ?? [],
            codeVersion: params.codeVersion,
        };
        const page = {
            frontmatter,
            body: params.body,
            rawFrontmatter: "",
        };
        this.storage.savePage(page);
        return page;
    }
    /**
     * Update an existing page
     */
    updatePage(pageId, updates) {
        requireWiki(this.storage);
        const existing = this.storage.loadPage(pageId);
        if (!existing) {
            throw new Error(`Page not found: ${pageId}`);
        }
        const updatedFrontmatter = {
            ...existing.frontmatter,
            ...updates,
            sources: updates.sources ? updates.sources.map(toSourceRef) : existing.frontmatter.sources,
            updatedAt: now(),
        };
        const page = {
            frontmatter: updatedFrontmatter,
            body: updates.body ?? existing.body,
            rawFrontmatter: existing.rawFrontmatter,
        };
        this.storage.savePage(page);
        return page;
    }
    /**
     * Load a wiki page
     */
    loadPage(pageId) {
        requireWiki(this.storage);
        return this.storage.loadPage(pageId);
    }
    /**
     * Delete a wiki page
     */
    deletePage(pageId) {
        requireWiki(this.storage);
        this.storage.deletePage(pageId);
    }
    /**
     * Get all pages
     */
    getAllPages() {
        requireWiki(this.storage);
        return this.storage.getAllPages();
    }
    // ========================================================================
    // Search
    // ========================================================================
    /**
     * Search wiki pages
     */
    search(query, filters, limit = 10) {
        requireWiki(this.storage);
        return this.storage.search(query, filters, limit);
    }
    /**
     * Get page index
     */
    getIndex() {
        requireWiki(this.storage);
        return this.storage.getIndex();
    }
    // ========================================================================
    // Staged Changes
    // ========================================================================
    /**
     * Stage a change for later application
     */
    stageChange(pageId, expectedRevision, newContent) {
        requireWiki(this.storage);
        const existing = this.storage.loadPage(pageId);
        if (!existing) {
            throw new Error(`Page not found: ${pageId}`);
        }
        const change = {
            pageId,
            expectedRevision,
            newContent,
            operationId: "",
        };
        this.storage.stageChange(change);
        return change;
    }
    /**
     * Get staged change for a page
     */
    getStagedChange(pageId) {
        requireWiki(this.storage);
        return this.storage.getStagedChange(pageId);
    }
    /**
     * Clear staged change
     */
    clearStagedChange(pageId) {
        requireWiki(this.storage);
        this.storage.clearStagedChange(pageId);
    }
    // ========================================================================
    // Apply Changes
    // ========================================================================
    /**
     * Apply staged change with conflict detection
     */
    applyChange(pageId, _requestId) {
        requireWiki(this.storage);
        const staged = this.storage.getStagedChange(pageId);
        if (!staged) {
            throw new Error(`No staged change for page: ${pageId}`);
        }
        const existing = this.storage.loadPage(pageId);
        if (!existing) {
            throw new Error(`Page not found: ${pageId}`);
        }
        // Check for conflicts - hash entire page content to detect any changes
        const currentRevision = computeHash((existing.rawFrontmatter || "") + "\n" + existing.body);
        if (staged.expectedRevision !== currentRevision) {
            throw new Error(`Conflict: page was modified. Expected revision ${staged.expectedRevision}, found ${currentRevision}`);
        }
        // Parse new content
        const parsed = parseFrontmatter(staged.newContent);
        if (!parsed.frontmatter) {
            throw new Error("Invalid page content: missing frontmatter");
        }
        // Create updated page
        const page = {
            frontmatter: {
                ...parsed.frontmatter,
                id: pageId,
                updatedAt: now(),
            },
            body: parsed.body,
            rawFrontmatter: parsed.raw,
        };
        this.storage.savePage(page);
        this.storage.clearStagedChange(pageId);
        return page;
    }
    // ========================================================================
    // Lint
    // ========================================================================
    /**
     * Run lint checks on wiki
     */
    lint(scope) {
        requireWiki(this.storage);
        const findings = [];
        if (scope === undefined || scope === "all" || scope === "pages") {
            findings.push(...this.lintPages());
        }
        if (scope === undefined || scope === "all" || scope === "links") {
            findings.push(...this.lintLinks());
        }
        if (scope === undefined || scope === "all" || scope === "freshness") {
            findings.push(...this.lintFreshness());
        }
        return findings;
    }
    /**
     * Lint page structure
     */
    lintPages() {
        const findings = [];
        const pages = this.storage.getAllPages();
        for (const page of pages) {
            // Check required frontmatter fields
            if (!page.frontmatter.id) {
                findings.push({
                    severity: "error",
                    category: "structure",
                    pageId: page.frontmatter.id,
                    message: "Missing id in frontmatter",
                });
            }
            if (!page.frontmatter.title) {
                findings.push({
                    severity: "error",
                    category: "structure",
                    pageId: page.frontmatter.id,
                    message: "Missing title in frontmatter",
                });
            }
            if (!page.frontmatter.kind) {
                findings.push({
                    severity: "error",
                    category: "structure",
                    pageId: page.frontmatter.id,
                    message: "Missing kind in frontmatter",
                });
            }
            // Check for missing sources in non-reference pages
            if (page.frontmatter.kind !== "reference" &&
                page.frontmatter.sources.length === 0) {
                findings.push({
                    severity: "warning",
                    category: "evidence",
                    pageId: page.frontmatter.id,
                    message: "Page has no source citations",
                });
            }
            // Check for verified status without evidence
            if (page.frontmatter.status === "verified" && !page.frontmatter.verification) {
                findings.push({
                    severity: "warning",
                    category: "evidence",
                    pageId: page.frontmatter.id,
                    message: "Page has 'verified' status but no verification evidence",
                });
            }
        }
        return findings;
    }
    /**
     * Lint link validity
     */
    lintLinks() {
        const findings = [];
        const pages = this.storage.getAllPages();
        const pageIds = new Set(pages.map((p) => p.frontmatter.id));
        for (const page of pages) {
            // Check related pages exist
            for (const relatedId of page.frontmatter.relatedPages) {
                if (!pageIds.has(relatedId)) {
                    findings.push({
                        severity: "warning",
                        category: "links",
                        pageId: page.frontmatter.id,
                        message: `Related page not found: ${relatedId}`,
                    });
                }
            }
            // Check source snapshots exist
            for (const source of page.frontmatter.sources) {
                if (!this.storage.getSnapshot(source.sourceId)) {
                    findings.push({
                        severity: "warning",
                        category: "links",
                        pageId: page.frontmatter.id,
                        message: `Source snapshot not found: ${source.sourceId}`,
                    });
                }
            }
        }
        return findings;
    }
    /**
     * Lint freshness
     */
    lintFreshness() {
        const findings = [];
        const pages = this.storage.getAllPages();
        const nowTime = Date.now();
        const staleThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days
        for (const page of pages) {
            const updatedTime = new Date(page.frontmatter.updatedAt).getTime();
            const age = nowTime - updatedTime;
            // Flag old pages without verification
            if (page.frontmatter.status !== "verified" &&
                page.frontmatter.status !== "superseded" &&
                age > staleThreshold) {
                findings.push({
                    severity: "info",
                    category: "freshness",
                    pageId: page.frontmatter.id,
                    message: `Page has not been updated in ${Math.floor(age / (24 * 60 * 60 * 1000))} days`,
                });
            }
            // Check if sources have changed
            for (const source of page.frontmatter.sources) {
                const snapshot = this.storage.getSnapshot(source.sourceId);
                if (snapshot) {
                    const snapTime = new Date(snapshot.capturedAt).getTime();
                    if (snapTime < updatedTime) {
                        findings.push({
                            severity: "warning",
                            category: "freshness",
                            pageId: page.frontmatter.id,
                            message: `Source ${source.sourceId} was captured before page was last updated`,
                            suggestion: "Consider re-ingesting source to verify content is current",
                        });
                    }
                }
            }
        }
        return findings;
    }
    // ========================================================================
    // Operations
    // ========================================================================
    /**
     * Get recent operations
     */
    getRecentOperations(limit = 50) {
        requireWiki(this.storage);
        return this.storage.getRecentOperations(limit);
    }
}
// ============================================================================
// Factory
// ============================================================================
/**
 * Create wiki manager for a workspace
 */
export function createWikiManager(workspaceRoot, projectId) {
    const storage = createWikiStorage(workspaceRoot, projectId);
    const manager = new WikiManager(storage);
    // Initialize storage if feature is enabled (may be called lazily later)
    if (process.env.HARNESS_KNOWLEDGE_WIKI === "1") {
        storage.initialize();
    }
    return manager;
}
// Re-export storage class
export { WikiStorage, createWikiStorage } from "./storage.js";
/**
 * Check if wiki exists in workspace
 */
export function wikiExists(workspaceRoot) {
    const wikiRoot = join(workspaceRoot, "wiki");
    return existsSync(join(wikiRoot, "knowledge"));
}
// ============================================================================
// Exports
// ============================================================================
export * from "./types.js";
//# sourceMappingURL=index.js.map