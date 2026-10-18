/**
 * Wiki Package Types
 *
 * Implements LLM Wiki integration per wiki/llm-wiki-integration-minimax-plan.md
 */

// ============================================================================
// Page Types
// ============================================================================

/**
 * Wiki page status lifecycle
 */
export type PageStatus =
  | "proposed"      // Awaiting synthesis/verification
  | "implemented"    // Applied but not yet verified
  | "verified"       // Test/inspection evidence recorded
  | "stale"          // Source changed, needs review
  | "superseded";    // Replaced by another page

/**
 * Page kind categories
 */
export type PageKind =
  | "concept"        // Architectural/design concept
  | "decision"       // Design decision with rationale
  | "incident"       // Incident record with lessons
  | "plan"           // Implementation plan
  | "verification"   // Test/audit results
  | "reference";     // Technical reference

/**
 * Source reference in page frontmatter
 */
export interface SourceRef {
  sourceId: string;       // Stable snapshot ID
  path: string;           // Original source path
  contentHash: string;    // SHA-256 of captured content
  capturedAt: string;     // ISO timestamp
  redacted: boolean;      // Whether secrets were redacted
}

/**
 * Wiki page frontmatter
 */
export interface WikiPageFrontmatter {
  id: string;                    // Stable page ID (UUID)
  title: string;                 // Human-readable title
  kind: PageKind;                // Page category
  projectId: string;             // Canonical workspace identifier
  status: PageStatus;            // Lifecycle status
  createdAt: string;              // ISO timestamp
  updatedAt: string;             // ISO timestamp
  sources: SourceRef[];          // Immutable source snapshots
  relatedPages: string[];        // Related page IDs
  codeVersion?: string;          // Applicable code/package version
  supersedes?: string;           // Page ID this supersedes
  supersededBy?: string;         // Page ID that supersedes this
  verification?: {
    evidence: string;            // Test/inspection reference
    scope?: string;              // Scope of verification
    version?: string;            // Verified version
  };
}

/**
 * Wiki page content
 */
export interface WikiPage {
  frontmatter: WikiPageFrontmatter;
  body: string;                  // Markdown body with citations
  rawFrontmatter: string;       // Original YAML for comparison
}

// ============================================================================
// Source Snapshot Types
// ============================================================================

/**
 * Immutable source snapshot (stored in raw/ directory)
 */
export interface SourceSnapshot {
  id: string;                    // Stable snapshot ID
  originalPath: string;          // Path when captured
  contentHash: string;           // SHA-256 of content
  capturedAt: string;            // ISO timestamp
  content: string;               // Actual content (may be redacted)
  redacted: boolean;             // Whether secrets were removed
  operationId: string;          // Operation that created this
}

/**
 * Convert SourceSnapshot to SourceRef for frontmatter
 */
export function toSourceRef(snap: SourceSnapshot): SourceRef {
  return {
    sourceId: snap.id,
    path: snap.originalPath,
    contentHash: snap.contentHash,
    capturedAt: snap.capturedAt,
    redacted: snap.redacted,
  };
}

// ============================================================================
// Operation Types
// ============================================================================

/**
 * Wiki operation types
 */
export type WikiOperationType =
  | "init"           // Initialize wiki structure
  | "ingest"         // Ingest new source
  | "synthesize"     // Create/update page synthesis
  | "apply"          // Apply staged changes
  | "lint"           // Run lint checks
  | "verify";        // Add verification evidence

/**
 * Operation status
 */
export type OperationStatus = "pending" | "success" | "failed" | "conflict";

/**
 * Operation log entry
 */
export interface WikiOperation {
  id: string;                    // Stable operation ID
  type: WikiOperationType;
  status: OperationStatus;
  startedAt: string;              // ISO timestamp
  completedAt?: string;           // ISO timestamp
  requestId?: string;             // Client request ID
  details: Record<string, unknown>; // Operation-specific details
  error?: string;                 // Error message if failed
}

/**
 * Staged change for apply operation
 */
export interface StagedChange {
  pageId: string;
  expectedRevision: string;       // Revision that changes are based on
  newContent: string;             // New page content
  operationId: string;           // Operation that staged this
}

// ============================================================================
// Index and Search Types
// ============================================================================

/**
 * Page index entry (lightweight, for search)
 */
export interface PageIndexEntry {
  id: string;
  title: string;
  kind: PageKind;
  status: PageStatus;
  tags: string[];
  summary: string;                // First ~200 chars of body
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
  sourceIds?: string[];          // Pages citing specific sources
  updatedAfter?: string;         // ISO timestamp
  updatedBefore?: string;        // ISO timestamp
}

/**
 * Search result
 */
export interface WikiSearchResult {
  page: PageIndexEntry;
  relevance: number;              // 0-1 score
  matchedOn: ("title" | "body" | "tags" | "kind" | "source")[];
  snippets: string[];             // Matching text snippets
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Lint finding severity
 */
export type LintSeverity = "error" | "warning" | "info";

/**
 * Lint finding category
 */
export type LintCategory =
  | "structure"       // Schema violations
  | "links"           // Broken/invalid links
  | "freshness"       // Stale content
  | "evidence"        // Missing verification
  | "duplicates"      // Duplicate content
  | "semantic";       // Potential contradictions (model-assisted)

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
  modelAssisted?: boolean;       // True if derived by model, not deterministic
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Wiki configuration
 */
export interface WikiConfig {
  wikiRoot: string;               // Root wiki directory
  workspaceRoot: string;          // Workspace root (parent of wikiRoot)
  rawDir: string;                // Source snapshots directory
  knowledgeDir: string;          // Generated pages directory
  harnessDir: string;           // Internal .harness directory
  indexFile: string;             // Page index file
  logFile: string;               // Operation log file
  schemaFile: string;            // Schema conventions file
  projectId: string;             // Canonical project identifier
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
export const WIKI_DIRS = {
  RAW: "raw",
  KNOWLEDGE: "knowledge",
  HARNESS: ".harness",
  INDEX: "index.json",
  LOG: "log.jsonl",
  SCHEMA: "SCHEMA.md",
  INDEX_MD: "index.md",
} as const;
