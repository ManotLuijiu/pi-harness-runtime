/**
 * Wiki Storage - File-based persistence for wiki pages
 *
 * Handles atomic writes, transactions, and consistency.
 */
import type { WikiConfig, WikiPage, WikiPageFrontmatter, SourceSnapshot, WikiOperation, PageIndexEntry, WikiInitResult, WikiOperationType, WikiSearchFilters, WikiSearchResult, StagedChange } from "./types.js";
/**
 * Compute SHA-256 hash of content
 */
export declare function computeHash(content: string): string;
/**
 * Get current ISO timestamp
 */
export declare function now(): string;
/**
 * Parse YAML frontmatter from markdown content
 */
export declare function parseFrontmatter(content: string): {
    frontmatter: WikiPageFrontmatter | null;
    body: string;
    raw: string;
};
/**
 * Serialize frontmatter to YAML string
 */
export declare function serializeFrontmatter(frontmatter: WikiPageFrontmatter): string;
/**
 * Combine frontmatter and body into full page content
 */
export declare function combinePage(frontmatter: WikiPageFrontmatter, body: string): string;
/**
 * Wiki storage manager
 */
export declare class WikiStorage {
    private config;
    private index;
    private indexMtime;
    private operations;
    private stagedChanges;
    private initialized;
    private modifiedIds;
    private deletedIds;
    constructor(config: WikiConfig);
    /**
     * Initialize storage (call before any read/write operations)
     * This is called automatically by WikiManager when feature is enabled
     */
    initializeStorage(): void;
    /**
     * Check if storage is initialized
     */
    isInitialized(): boolean;
    /**
     * Get wiki configuration
     */
    getConfig(): WikiConfig;
    /**
     * Initialize wiki structure
     */
    initialize(): WikiInitResult;
    /**
     * Load page index from disk (if changed since last load)
     */
    private loadIndex;
    /**
     * Save page index to disk (atomic)
     * Only applies changes from this manager instance (tracked via modifiedIds)
     * Respects deletions tracked via deletedIds
     */
    private saveIndex;
    /**
     * Load index from disk only (no cache)
     */
    private loadIndexFromDisk;
    /**
     * Load operations from log
     */
    private loadOperations;
    /**
     * Append operation to log
     */
    private appendOperation;
    /**
     * Load staged changes
     */
    private loadStaged;
    /**
     * Save staged changes (atomic)
     */
    private saveStaged;
    /**
     * Create immutable source snapshot
     */
    createSnapshot(originalPath: string, content: string, operationId: string): SourceSnapshot;
    /**
     * Get source snapshot by ID
     */
    getSnapshot(snapshotId: string): SourceSnapshot | null;
    /**
     * Save a wiki page
     */
    savePage(page: WikiPage): void;
    /**
     * Load a wiki page
     */
    loadPage(pageId: string): WikiPage | null;
    /**
     * Validate page ID to prevent path traversal attacks
     */
    private validatePageId;
    /**
     * Validate snapshot ID to prevent path traversal attacks
     */
    private validateSnapshotId;
    /**
     * Check if a path or any of its parent directories is a symlink
     */
    private hasSymlinkComponent;
    /**
     * Ensure a path is within the expected directory (defense in depth)
     */
    private ensureWithinDirectory;
    /**
     * Delete a wiki page
     */
    deletePage(pageId: string): void;
    /**
     * Get all pages
     */
    getAllPages(): WikiPage[];
    /**
     * Stage a change for later application
     */
    stageChange(change: StagedChange): void;
    /**
     * Get staged change for a page
     */
    getStagedChange(pageId: string): StagedChange | undefined;
    /**
     * Clear staged change
     */
    clearStagedChange(pageId: string): void;
    /**
     * Get all staged changes
     */
    getAllStagedChanges(): StagedChange[];
    /**
     * Log an operation
     */
    logOperation(type: WikiOperationType, details: Record<string, unknown>, requestId?: string): WikiOperation;
    /**
     * Update operation status
     */
    completeOperation(opId: string, status: WikiOperation["status"], error?: string): void;
    /**
     * Update operation details (before completion)
     */
    updateOperationDetails(opId: string, details: Record<string, unknown>): void;
    /**
     * Get recent operations
     */
    getRecentOperations(limit?: number): WikiOperation[];
    /**
     * Search wiki pages
     */
    search(query: string, filters?: WikiSearchFilters, limit?: number): WikiSearchResult[];
    /**
     * Get page index
     */
    getIndex(): PageIndexEntry[];
}
/**
 * Create wiki storage for a workspace
 */
export declare function createWikiStorage(workspaceRoot: string, projectId: string): WikiStorage;
//# sourceMappingURL=storage.d.ts.map