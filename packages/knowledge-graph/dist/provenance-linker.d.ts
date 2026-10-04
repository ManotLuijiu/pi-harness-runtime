/**
 * Knowledge Graph - RFC-0106
 *
 * Provenance linking between skills, RFCs, and implementations.
 */
import type { KnowledgeEdge, KnowledgeGraph } from './types.js';
/**
 * Build provenance edges based on metadata
 */
export declare function buildProvenanceEdges(graph: KnowledgeGraph): KnowledgeEdge[];
/**
 * Infer additional edges from content analysis
 */
export declare function inferRelationships(graph: KnowledgeGraph): KnowledgeEdge[];
/**
 * Complete graph with all provenance links
 */
export declare function completeGraph(graph: KnowledgeGraph): KnowledgeGraph;
//# sourceMappingURL=provenance-linker.d.ts.map