/**
 * Wiki Package Types
 *
 * Implements LLM Wiki integration per wiki/llm-wiki-integration-minimax-plan.md
 */
/**
 * Convert SourceSnapshot to SourceRef for frontmatter
 */
export function toSourceRef(snap) {
    return {
        sourceId: snap.id,
        path: snap.originalPath,
        contentHash: snap.contentHash,
        capturedAt: snap.capturedAt,
        redacted: snap.redacted,
    };
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
};
//# sourceMappingURL=types.js.map