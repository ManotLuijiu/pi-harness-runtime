/**
 * Knowledge Graph - RFC-0106
 *
 * Typed definitions for knowledge graph nodes and edges.
 */
export type KnowledgeNodeType = 'skill' | 'rfc' | 'implementation' | 'concept' | 'api' | 'cli' | 'pattern' | 'workflow';
export interface KnowledgeNode {
    id: string;
    type: KnowledgeNodeType;
    data: {
        title: string;
        description?: string;
        tags: string[];
        source?: string;
        url?: string;
    };
}
export type KnowledgeEdgeType = 'implements' | 'depends_on' | 'supersedes' | 'related_to' | 'authored_by' | 'documents' | 'references';
export interface KnowledgeEdge {
    from: string;
    to: string;
    type: KnowledgeEdgeType;
    metadata?: {
        confidence?: number;
        source?: string;
    };
}
export interface KnowledgeGraph {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
}
export interface ProvenanceData {
    implements?: string;
    related_implementation?: string;
    author?: string;
    version?: string;
}
export interface SearchResult {
    node: KnowledgeNode;
    score: number;
    highlights?: string[];
}
export interface SearchOptions {
    limit?: number;
    type?: KnowledgeNodeType;
    tags?: string[];
}
export interface TencentDBConfig {
    knowledgeUrl: string;
    userKey: string;
    serviceId: string;
}
//# sourceMappingURL=types.d.ts.map