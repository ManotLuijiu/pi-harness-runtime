/**
 * Wiki Package - Main API
 *
 * Implements LLM Wiki integration per wiki/llm-wiki-integration-minimax-plan.md
 */
import { WikiStorage } from "./storage.js";
import type { WikiConfig, WikiPage, WikiPageFrontmatter, SourceSnapshot, WikiOperation, WikiSearchFilters, WikiSearchResult, LintFinding, StagedChange, WikiInitResult, PageStatus, PageKind } from "./types.js";
/**
 * Check if wiki feature is enabled
 */
export declare function isWikiEnabled(): boolean;
/**
 * Wiki manager - main API for wiki operations
 */
export declare class WikiManager {
    private storage;
    private config;
    constructor(storage: WikiStorage);
    /**
     * Get wiki configuration
     */
    getConfig(): WikiConfig;
    /**
     * Initialize wiki structure
     */
    initialize(): WikiInitResult;
    /**
     * Check if wiki is initialized
     */
    isInitialized(): boolean;
    /**
     * Ingest a source file and create snapshot
     * Returns existing snapshot if same requestId was already processed
     */
    ingestSource(sourcePath: string, requestId?: string): {
        snapshot: SourceSnapshot;
        operation: WikiOperation;
        existing: boolean;
    };
    /**
     * Get source snapshot
     */
    getSnapshot(snapshotId: string): SourceSnapshot | null;
    /**
     * Create a new wiki page
     */
    createPage(params: {
        title: string;
        kind: PageKind;
        body: string;
        sources?: SourceSnapshot[];
        relatedPages?: string[];
        codeVersion?: string;
    }): WikiPage;
    /**
     * Update an existing page
     */
    updatePage(pageId: string, updates: Partial<{
        title: string;
        status: PageStatus;
        body: string;
        sources: SourceSnapshot[];
        relatedPages: string[];
        codeVersion: string;
        verification: WikiPageFrontmatter["verification"];
    }>): WikiPage;
    /**
     * Load a wiki page
     */
    loadPage(pageId: string): WikiPage | null;
    /**
     * Delete a wiki page
     */
    deletePage(pageId: string): void;
    /**
     * Get all pages
     */
    getAllPages(): WikiPage[];
    /**
     * Search wiki pages
     */
    search(query: string, filters?: WikiSearchFilters, limit?: number): WikiSearchResult[];
    /**
     * Get page index
     */
    getIndex(): import("./types.js").PageIndexEntry[];
    /**
     * Stage a change for later application
     */
    stageChange(pageId: string, expectedRevision: string, newContent: string): StagedChange;
    /**
     * Get staged change for a page
     */
    getStagedChange(pageId: string): StagedChange | undefined;
    /**
     * Clear staged change
     */
    clearStagedChange(pageId: string): void;
    /**
     * Apply staged change with conflict detection
     */
    applyChange(pageId: string, _requestId?: string): WikiPage;
    /**
     * Run lint checks on wiki
     */
    lint(scope?: "all" | "pages" | "links" | "freshness"): LintFinding[];
    /**
     * Lint page structure
     */
    private lintPages;
    /**
     * Lint link validity
     */
    private lintLinks;
    /**
     * Lint freshness
     */
    private lintFreshness;
    /**
     * Get recent operations
     */
    getRecentOperations(limit?: number): WikiOperation[];
}
/**
 * Create wiki manager for a workspace
 */
export declare function createWikiManager(workspaceRoot: string, projectId: string): WikiManager;
export { WikiStorage, createWikiStorage } from "./storage.js";
/**
 * Check if wiki exists in workspace
 */
export declare function wikiExists(workspaceRoot: string): boolean;
export * from "./types.js";
//# sourceMappingURL=index.d.ts.map