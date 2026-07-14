/**
 * Memory Engine (RFC-0060)
 *
 * Manages durable knowledge using Google's Open Knowledge Format (OKF).
 */
import type { OkfConcept, OkfLink, KnowledgeBundle, ValidationResult, KnowledgeQuery, KnowledgeResult, WriteConceptRequest } from "./types.js";
/**
 * Extract markdown links from content
 * Used for link validation and concept parsing
 */
export declare function extractLinks(markdown: string): OkfLink[];
export declare function validateConcept(content: string, path: string): ValidationResult;
export declare class MemoryEngine {
    private bundle;
    private ensureBundle;
    /**
     * Load an OKF bundle from a directory path.
     * Recursively reads all .md files, parses frontmatter + body,
     * and builds the in-memory concept index.
     */
    loadBundle(bundlePath: string): Promise<KnowledgeBundle>;
    /**
     * Validate a bundle
     */
    validateBundle(bundle: KnowledgeBundle): ValidationResult;
    /**
     * Search for concepts matching a query
     */
    search(query: KnowledgeQuery): KnowledgeResult[];
    /**
     * Write a new concept (RFC-0060)
     *
     * Persists to disk at {bundle.path}/{id}.md and updates bundle index.
     * File name is derived from the title slug (first 64 chars).
     */
    writeConcept(request: WriteConceptRequest): Promise<OkfConcept>;
    /**
     * Promote a concept from the blackboard
     */
    promoteFromBlackboard(blackboardContent: string, metadata: Record<string, unknown>): WriteConceptRequest;
    /**
     * Rebuild the index from disk and persist index.md to bundle directory.
     */
    rebuildIndex(bundlePath?: string): Promise<void>;
    /**
     * Get the current bundle
     */
    getBundle(): KnowledgeBundle | null;
    /**
     * Export a concept to OKF format (RFC-0060)
     *
     * Excludes bundle-level metadata fields (index, log, directories)
     * from the concept frontmatter to ensure clean round-trip parsing.
     */
    exportToOkf(concept: OkfConcept): string;
}
export declare function createMemoryEngine(): MemoryEngine;
//# sourceMappingURL=engine.d.ts.map