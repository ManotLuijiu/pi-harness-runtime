/**
 * Wiki Package Types
 *
 * Implements LLM Wiki integration per wiki/llm-wiki-integration-minimax-plan.md
 */
/**
 * Wiki page status lifecycle
 */
export type PageStatus = "proposed" | "implemented" | "verified" | "stale" | "superseded";
/**
 * Page kind categories
 */
export type PageKind = "concept" | "decision" | "incident" | "plan" | "verification" | "reference";
/**
 * Source reference in page frontmatter
 */
export interface SourceRef {
    sourceId: string;
    path: string;
    contentHash: string;
    capturedAt: string;
    redacted: boolean;
}
/**
 * Wiki page frontmatter
 */
export interface WikiPageFrontmatter {
    id: string;
    title: string;
    kind: PageKind;
    projectId: string;
    status: PageStatus;
    createdAt: string;
    updatedAt: string;
    sources: SourceRef[];
    relatedPages: string[];
    codeVersion?: string;
    supersedes?: string;
    supersededBy?: string;
    verification?: {
        evidence: string;
        scope?: string;
        version?: string;
    };
}
/**
 * Wiki page content
 */
export interface WikiPage {
    frontmatter: WikiPageFrontmatter;
    body: string;
    rawFrontmatter: string;
}
/**
 * Immutable source snapshot (stored in raw/ directory)
 */
export interface SourceSnapshot {
    id: string;
    originalPath: string;
    contentHash: string;
    capturedAt: string;
    content: string;
    redacted: boolean;
    operationId: string;
}
/**
 * Convert SourceSnapshot to SourceRef for frontmatter
 */
export declare function toSourceRef(snap: SourceSnapshot): SourceRef;
/**
 * Wiki operation types
 */
export type WikiOperationType = "init" | "ingest" | "synthesize" | "apply" | "lint" | "verify";
/**
 * Operation status
 */
export type OperationStatus = "pending" | "success" | "failed" | "conflict";
/**
 * Operation log entry
 */
export interface WikiOperation {
    id: string;
    type: WikiOperationType;
    status: OperationStatus;
    startedAt: string;
    completedAt?: string;
    requestId?: string;
    details: Record<string, unknown>;
    error?: string;
}
/**
 * Staged change for apply operation
 */
export interface StagedChange {
    pageId: string;
    expectedRevision: string;
    newContent: string;
    operationId: string;
}
/**
 * Page index entry (lightweight, for search)
 */
export interface PageIndexEntry {
    id: string;
    title: string;
    kind: PageKind;
    status: PageStatus;
    tags: string[];
    summary: string;
    updatedAt: string;
    codeVersion?: string;
}
/**
 * Search filters
 */
export interface WikiSearchFilters {
    kinds?: PageKind[];
    statuses?: PageStatus[];
    tags?: string[];
    sourceIds?: string[];
    updatedAfter?: string;
    updatedBefore?: string;
}
/**
 * Search result
 */
export interface WikiSearchResult {
    page: PageIndexEntry;
    relevance: number;
    matchedOn: ("title" | "body" | "tags" | "kind" | "source")[];
    snippets: string[];
}
/**
 * Lint finding severity
 */
export type LintSeverity = "error" | "warning" | "info";
/**
 * Lint finding category
 */
export type LintCategory = "structure" | "links" | "freshness" | "evidence" | "duplicates" | "semantic";
/**
 * Lint finding
 */
export interface LintFinding {
    severity: LintSeverity;
    category: LintCategory;
    pageId?: string;
    message: string;
    location?: {
        line?: number;
        path?: string;
    };
    suggestion?: string;
    modelAssisted?: boolean;
}
/**
 * Wiki configuration
 */
export interface WikiConfig {
    wikiRoot: string;
    rawDir: string;
    knowledgeDir: string;
    harnessDir: string;
    indexFile: string;
    logFile: string;
    schemaFile: string;
    projectId: string;
}
/**
 * Wiki initialization result
 */
export interface WikiInitResult {
    created: boolean;
    existing: boolean;
    config: WikiConfig;
}
/**
 * Default wiki directory names
 */
export declare const WIKI_DIRS: {
    readonly RAW: "raw";
    readonly KNOWLEDGE: "knowledge";
    readonly HARNESS: ".harness";
    readonly INDEX: "index.json";
    readonly LOG: "log.jsonl";
    readonly SCHEMA: "SCHEMA.md";
    readonly INDEX_MD: "index.md";
};
//# sourceMappingURL=types.d.ts.map