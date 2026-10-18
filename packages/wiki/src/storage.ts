/**
 * Wiki Storage - File-based persistence for wiki pages
 *
 * Handles atomic writes, transactions, and consistency.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  WikiConfig,
  WikiPage,
  WikiPageFrontmatter,
  SourceSnapshot,
  WikiOperation,
  PageIndexEntry,
  WikiInitResult,
  WikiOperationType,
  WikiSearchFilters,
  WikiSearchResult,
  LintFinding,
  StagedChange,
  WIKI_DIRS,
} from "./types.js";

// ============================================================================
// Utilities
// ============================================================================

/**
 * Compute SHA-256 hash of content
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Get current ISO timestamp
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(
  content: string
): { frontmatter: WikiPageFrontmatter | null; body: string; raw: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    return { frontmatter: null, body: content, raw: "" };
  }

  const [, yamlStr, body] = match;
  const frontmatter = parseYaml(yamlStr);

  return {
    // SAFETY: parseYaml returns Record<string, unknown>, cast through unknown to satisfy TS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    frontmatter: frontmatter as any,
    body: body.trim(),
    raw: yamlStr,
  };
}

/**
 * Simple YAML parser for frontmatter
 * Handles: strings, booleans, numbers, arrays, nested objects
 */
function parseYaml(yamlStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlStr.split("\n");
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.search(/\S/);
    const colonIdx = trimmed.indexOf(":");

    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: unknown = trimmed.slice(colonIdx + 1).trim();

    // Pop stack while indent decreases
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;

    // Parse value
    if (value === "" || value === "null" || value === "~") {
      value = null;
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (/^-?\d+(\.\d+)?$/.test(value as string)) {
      value = parseFloat(value as string);
    } else if ((value as string).startsWith("[") && (value as string).endsWith("]")) {
      // Array
      const arrContent = (value as string).slice(1, -1);
      value = arrContent
        ? arrContent.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))
        : [];
    } else {
      // String - remove quotes
      value = (value as string).replace(/^["']|["']$/g, "");
    }

    parent[key] = value;
  }

  return result;
}

/**
 * Serialize frontmatter to YAML string
 */
export function serializeFrontmatter(
  frontmatter: WikiPageFrontmatter
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (value.every((v) => typeof v === "object" && v !== null)) {
        // Array of objects - serialize as proper YAML
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - sourceId: ${(item as Record<string, unknown>).sourceId}`);
          lines.push(`    path: ${(item as Record<string, unknown>).path}`);
          lines.push(`    contentHash: ${(item as Record<string, unknown>).contentHash}`);
          lines.push(`    capturedAt: ${(item as Record<string, unknown>).capturedAt}`);
          lines.push(`    redacted: ${(item as Record<string, unknown>).redacted}`);
        }
      } else {
        lines.push(`${key}: [${value.join(", ")}]`);
      }
    } else if (typeof value === "object") {
      // Nested object
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  ${k}: ${JSON.stringify(v)}`);
      }
    } else if (typeof value === "boolean" || typeof value === "number") {
      lines.push(`${key}: ${value}`);
    } else {
      // String - quote if needed
      const str = String(value);
      if (str.includes(":") || str.includes("#") || str.includes("\n")) {
        lines.push(`${key}: "${str.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${str}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Combine frontmatter and body into full page content
 */
export function combinePage(
  frontmatter: WikiPageFrontmatter,
  body: string
): string {
  return `---\n${serializeFrontmatter(frontmatter)}\n---\n\n${body}`;
}

// ============================================================================
// Storage Implementation
// ============================================================================

/**
 * Wiki storage manager
 */
export class WikiStorage {
  private config: WikiConfig;
  private index: Map<string, PageIndexEntry> = new Map();
  private indexMtime = 0; // Track when index was last loaded
  private operations: WikiOperation[] = [];
  private stagedChanges: Map<string, StagedChange> = new Map();

  constructor(config: WikiConfig) {
    this.config = config;
    this.ensureStructure();
    this.loadIndex();
    this.loadOperations();
    this.loadStaged();
  }

  /**
   * Get wiki configuration
   */
  getConfig(): WikiConfig {
    return this.config;
  }

  /**
   * Initialize wiki structure
   */
  initialize(): WikiInitResult {
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
      writeFileSync(
        this.config.schemaFile,
        `# Wiki Maintenance Conventions

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
`,
        "utf8"
      );
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
  private ensureStructure(): void {
    if (!existsSync(this.config.wikiRoot)) {
      mkdirSync(this.config.wikiRoot, { recursive: true });
    }
  }

  /**
   * Load page index from disk (if changed since last load)
   */
  private loadIndex(force = false): void {
    if (!force) {
      try {
        const stat = statSync(this.config.indexFile);
        // Only reload if file was modified since last load
        if (stat.mtimeMs <= this.indexMtime) {
          return;
        }
      } catch {
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
      const entries: PageIndexEntry[] = JSON.parse(content);
      for (const entry of entries) {
        this.index.set(entry.id, entry);
      }
      const stat = statSync(this.config.indexFile);
      this.indexMtime = stat.mtimeMs;
    } catch {
      // Invalid index, rebuild
      this.indexMtime = 0;
    }
  }

  /**
   * Save page index to disk (atomic)
   */
  private saveIndex(): void {
    const entries = Array.from(this.index.values());
    const content = JSON.stringify(entries, null, 2);
    const tmpFile = this.config.indexFile + ".tmp";
    writeFileSync(tmpFile, content, "utf8");
    renameSync(tmpFile, this.config.indexFile);
  }

  /**
   * Load operations from log
   */
  private loadOperations(): void {
    this.operations = [];
    if (!existsSync(this.config.logFile)) return;

    try {
      const content = readFileSync(this.config.logFile, "utf8");
      const lines = content.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          this.operations.push(JSON.parse(line));
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // No log yet
    }
  }

  /**
   * Append operation to log
   */
  private appendOperation(op: WikiOperation): void {
    const line = JSON.stringify(op) + "\n";
    writeFileSync(this.config.logFile, line, { flag: "a", encoding: "utf8" });
    this.operations.push(op);
  }

  /**
   * Load staged changes
   */
  private loadStaged(): void {
    this.stagedChanges.clear();
    const stagedFile = join(this.config.harnessDir, "staged.json");
    if (!existsSync(stagedFile)) return;

    try {
      const content = readFileSync(stagedFile, "utf8");
      const changes: StagedChange[] = JSON.parse(content);
      for (const change of changes) {
        this.stagedChanges.set(change.pageId, change);
      }
    } catch {
      // Invalid staged file
    }
  }

  /**
   * Save staged changes (atomic)
   */
  private saveStaged(): void {
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
  createSnapshot(
    originalPath: string,
    content: string,
    operationId: string
  ): SourceSnapshot {
    const id = `snap-${randomUUID().slice(0, 8)}`;
    const snapshot: SourceSnapshot = {
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
  getSnapshot(snapshotId: string): SourceSnapshot | null {
    const snapFile = join(this.config.rawDir, `${snapshotId}.json`);
    if (!existsSync(snapFile)) return null;

    try {
      const content = readFileSync(snapFile, "utf8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  // ========================================================================
  // Page Operations
  // ========================================================================

  /**
   * Save a wiki page
   */
  savePage(page: WikiPage): void {
    const content = combinePage(page.frontmatter, page.body);
    const pageFile = join(this.config.knowledgeDir, `${page.frontmatter.id}.md`);
    const tmpFile = pageFile + ".tmp";
    writeFileSync(tmpFile, content, "utf8");
    renameSync(tmpFile, pageFile);

    // Update index
    const entry: PageIndexEntry = {
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
  }

  /**
   * Load a wiki page
   */
  loadPage(pageId: string): WikiPage | null {
    const pageFile = join(this.config.knowledgeDir, `${pageId}.md`);
    if (!existsSync(pageFile)) return null;

    const content = readFileSync(pageFile, "utf8");
    const { frontmatter, body, raw } = parseFrontmatter(content);

    if (!frontmatter) return null;

    return { frontmatter, body, rawFrontmatter: raw };
  }

  /**
   * Validate page ID to prevent path traversal attacks
   */
  private validatePageId(pageId: string): void {
    // Reject paths with directory separators or parent references
    if (pageId.includes("/") || pageId.includes("\\") || pageId.includes("..")) {
      throw new Error(`Invalid page ID: ${pageId}`);
    }
  }

  /**
   * Delete a wiki page
   */
  deletePage(pageId: string): void {
    this.validatePageId(pageId);
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
  getAllPages(): WikiPage[] {
    // Reload index to get latest changes from other processes
    this.loadIndex();

    const pages: WikiPage[] = [];
    if (!existsSync(this.config.knowledgeDir)) return pages;

    const files = readdirSync(this.config.knowledgeDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const pageId = file.replace(".md", "");
      const page = this.loadPage(pageId);
      if (page) pages.push(page);
    }

    return pages;
  }

  // ========================================================================
  // Staged Changes Operations
  // ========================================================================

  /**
   * Stage a change for later application
   */
  stageChange(change: StagedChange): void {
    this.stagedChanges.set(change.pageId, change);
    this.saveStaged();
  }

  /**
   * Get staged change for a page
   */
  getStagedChange(pageId: string): StagedChange | undefined {
    return this.stagedChanges.get(pageId);
  }

  /**
   * Clear staged change
   */
  clearStagedChange(pageId: string): void {
    this.stagedChanges.delete(pageId);
    this.saveStaged();
  }

  /**
   * Get all staged changes
   */
  getAllStagedChanges(): StagedChange[] {
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
  logOperation(
    type: WikiOperationType,
    details: Record<string, unknown>,
    requestId?: string
  ): WikiOperation {
    const op: WikiOperation = {
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
  completeOperation(opId: string, status: WikiOperation["status"], error?: string): void {
    const opIndex = this.operations.findIndex((o) => o.id === opId);
    if (opIndex === -1) return;

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
  updateOperationDetails(opId: string, details: Record<string, unknown>): void {
    const opIndex = this.operations.findIndex((o) => o.id === opId);
    if (opIndex === -1) return;

    this.operations[opIndex] = {
      ...this.operations[opIndex],
      details: { ...this.operations[opIndex].details, ...details },
    };
  }

  /**
   * Get recent operations
   */
  getRecentOperations(limit = 50): WikiOperation[] {
    return this.operations.slice(-limit);
  }

  // ========================================================================
  // Search
  // ========================================================================

  /**
   * Search wiki pages
   */
  search(query: string, filters?: WikiSearchFilters, limit = 10): WikiSearchResult[] {
    const queryLower = query.toLowerCase();
    const results: WikiSearchResult[] = [];

    for (const [_id, entry] of this.index) {
      // Apply filters
      if (filters?.kinds?.length && !filters.kinds.includes(entry.kind)) continue;
      if (filters?.statuses?.length && !filters.statuses.includes(entry.status)) continue;
      if (filters?.updatedAfter && entry.updatedAt < filters.updatedAfter) continue;
      if (filters?.updatedBefore && entry.updatedAt > filters.updatedBefore) continue;

      // Calculate relevance
      let relevance = 0;
      const matchedOn: WikiSearchResult["matchedOn"] = [];

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
  getIndex(): PageIndexEntry[] {
    return Array.from(this.index.values());
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create wiki storage for a workspace
 */
export function createWikiStorage(
  workspaceRoot: string,
  projectId: string
): WikiStorage {
  const wikiRoot = join(workspaceRoot, "wiki");

  const config: WikiConfig = {
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
