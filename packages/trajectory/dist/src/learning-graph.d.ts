/**
 * Learning Graph
 *
 * Timeline data structure for tracking learned items:
 * - Nodes: skills, memory, patterns, anti-patterns
 * - Edges: created_from, extends, replaces, derived_from
 *
 * Based on Hermes Agent's Learning Journey.
 */
/**
 * Learning node types
 */
export type NodeType = "skill" | "memory" | "pattern" | "anti-pattern";
/**
 * Learning edge types
 */
export type EdgeType = "created_from" | "extends" | "replaces" | "derived_from";
/**
 * Learning node
 */
export interface LearningNode {
    id: string;
    type: NodeType;
    name: string;
    description?: string;
    created_at: string;
    created_from?: string;
    usage_count: number;
    confidence?: number;
    author?: "agent" | "user" | "curator";
    metadata?: Record<string, unknown>;
}
/**
 * Learning edge
 */
export interface LearningEdge {
    id: string;
    source: string;
    target: string;
    type: EdgeType;
    weight?: number;
    created_at: string;
}
/**
 * Learning graph
 */
export interface LearningGraph {
    nodes: LearningNode[];
    edges: LearningEdge[];
    version: string;
    updated_at: string;
}
/**
 * Learning graph configuration
 */
export interface LearningGraphConfig {
    graphFile: string;
}
/**
 * Default configuration
 */
export declare const DEFAULT_GRAPH_CONFIG: LearningGraphConfig;
/**
 * Learning Graph class
 */
export declare class LearningGraphStore {
    private config;
    private graph;
    private dirty;
    constructor(config?: Partial<LearningGraphConfig>);
    /**
     * Load graph from file
     */
    private load;
    /**
     * Create empty graph
     */
    private createEmpty;
    /**
     * Save graph to file
     */
    save(): void;
    /**
     * Add a node
     */
    addNode(node: Omit<LearningNode, "id" | "created_at" | "usage_count">): LearningNode;
    /**
     * Add an edge
     */
    addEdge(edge: Omit<LearningEdge, "id" | "created_at">): LearningEdge;
    /**
     * Remove a node and its edges
     */
    removeNode(nodeId: string): boolean;
    /**
     * Get node by ID
     */
    getNode(nodeId: string): LearningNode | undefined;
    /**
     * Get nodes by type
     */
    getNodesByType(type: NodeType): LearningNode[];
    /**
     * Get edges from/to a node
     */
    getNodeEdges(nodeId: string): {
        incoming: LearningEdge[];
        outgoing: LearningEdge[];
    };
    /**
     * Increment usage count
     */
    incrementUsage(nodeId: string): void;
    /**
     * Update node
     */
    updateNode(nodeId: string, updates: Partial<LearningNode>): boolean;
    /**
     * Get all nodes
     */
    getAllNodes(): LearningNode[];
    /**
     * Get all edges
     */
    getAllEdges(): LearningEdge[];
    /**
     * Get full graph
     */
    getGraph(): LearningGraph;
    /**
     * Get nodes sorted by date
     */
    getTimeline(limit?: number): LearningNode[];
    /**
     * Get recent nodes by type
     */
    getRecent(type: NodeType, limit?: number): LearningNode[];
    /**
     * Search nodes
     */
    search(query: string): LearningNode[];
    /**
     * Get stats
     */
    getStats(): {
        totalNodes: number;
        byType: Record<NodeType, number>;
        totalEdges: number;
        byEdgeType: Record<EdgeType, number>;
        mostUsed: LearningNode[];
    };
    /**
     * Clear all nodes and edges
     */
    clear(): void;
}
export declare function getGlobalLearningGraph(): LearningGraphStore;
export declare function createLearningGraph(config?: Partial<LearningGraphConfig>): LearningGraphStore;
//# sourceMappingURL=learning-graph.d.ts.map