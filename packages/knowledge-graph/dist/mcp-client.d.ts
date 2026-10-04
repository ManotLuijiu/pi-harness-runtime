/**
 * Knowledge Graph - RFC-0106
 *
 * MCP tools for knowledge graph queries.
 */
import type { KnowledgeNode, KnowledgeEdge, KnowledgeGraph, SearchOptions, SearchResult, TencentDBConfig } from './types.js';
/**
 * Sync graph to TencentDB Knowledge Service
 */
export declare function syncGraphToKnowledgeService(graph: KnowledgeGraph, config: TencentDBConfig): Promise<{
    synced: number;
    errors: string[];
}>;
/**
 * Search knowledge graph
 */
export declare function searchGraph(query: string, config: TencentDBConfig, options?: SearchOptions): Promise<SearchResult[]>;
/**
 * Query graph by relationship type
 */
export declare function queryRelationships(config: TencentDBConfig, options: {
    type?: KnowledgeEdge['type'];
    from?: string;
    to?: string;
}): Promise<KnowledgeEdge[]>;
/**
 * Get a specific node by ID
 */
export declare function getNode(nodeId: string, config: TencentDBConfig): Promise<KnowledgeNode | null>;
/**
 * Find skills that implement a specific RFC
 */
export declare function findByRFC(rfcId: string, config: TencentDBConfig): Promise<KnowledgeNode[]>;
/**
 * Find related skills
 */
export declare function findRelated(skillId: string, config: TencentDBConfig, maxResults?: number): Promise<KnowledgeNode[]>;
//# sourceMappingURL=mcp-client.d.ts.map