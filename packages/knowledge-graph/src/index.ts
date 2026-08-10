/**
 * Knowledge Graph - RFC-0106
 *
 * Knowledge Graph extraction and provenance linking for SKILL.md files.
 *
 * @example
 * ```typescript
 * import { extractKnowledgeGraph, completeGraph, syncGraphToKnowledgeService } from '@pi-harness/knowledge-graph';
 *
 * // Extract graph from skills directory
 * const graph = await extractKnowledgeGraph(
 *   'frappe-bench/.claude-plugins/moocoding-skills/skills',
 *   'pi-harness-runtime/RFC'
 * );
 *
 * // Complete with provenance edges
 * const fullGraph = completeGraph(graph);
 *
 * // Sync to TencentDB Knowledge Service
 * await syncGraphToKnowledgeService(fullGraph, config);
 * ```
 */

export * from "./types.js";
export * from "./graph-extractor.js";
export * from "./provenance-linker.js";
export * from "./mcp-client.js";
