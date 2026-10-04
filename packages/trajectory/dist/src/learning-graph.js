/**
 * Learning Graph
 *
 * Timeline data structure for tracking learned items:
 * - Nodes: skills, memory, patterns, anti-patterns
 * - Edges: created_from, extends, replaces, derived_from
 *
 * Based on Hermes Agent's Learning Journey.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
/**
 * Default configuration
 */
export const DEFAULT_GRAPH_CONFIG = {
    graphFile: "~/.pi-harness/learning-graph.json",
};
/**
 * Expand path with ~
 */
function expandPath(path) {
    if (path.startsWith("~/")) {
        return join(homedir(), path.slice(2));
    }
    return path;
}
/**
 * Learning Graph class
 */
export class LearningGraphStore {
    config;
    graph;
    dirty = false;
    constructor(config) {
        this.config = { ...DEFAULT_GRAPH_CONFIG, ...config };
        this.config.graphFile = expandPath(this.config.graphFile);
        this.graph = this.load();
    }
    /**
     * Load graph from file
     */
    load() {
        if (!existsSync(this.config.graphFile)) {
            return this.createEmpty();
        }
        try {
            const content = readFileSync(this.config.graphFile, "utf-8");
            return JSON.parse(content);
        }
        catch (err) {
            console.error("[LearningGraph] Failed to load:", err);
            return this.createEmpty();
        }
    }
    /**
     * Create empty graph
     */
    createEmpty() {
        return {
            nodes: [],
            edges: [],
            version: "1.0",
            updated_at: new Date().toISOString(),
        };
    }
    /**
     * Save graph to file
     */
    save() {
        if (!this.dirty)
            return;
        this.graph.updated_at = new Date().toISOString();
        mkdirSync(dirname(this.config.graphFile), { recursive: true });
        writeFileSync(this.config.graphFile, JSON.stringify(this.graph, null, 2), "utf-8");
        this.dirty = false;
    }
    /**
     * Add a node
     */
    addNode(node) {
        const newNode = {
            ...node,
            id: `${node.type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            created_at: new Date().toISOString(),
            usage_count: 0,
        };
        this.graph.nodes.push(newNode);
        this.dirty = true;
        this.save();
        return newNode;
    }
    /**
     * Add an edge
     */
    addEdge(edge) {
        const newEdge = {
            ...edge,
            id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            created_at: new Date().toISOString(),
        };
        this.graph.edges.push(newEdge);
        this.dirty = true;
        this.save();
        return newEdge;
    }
    /**
     * Remove a node and its edges
     */
    removeNode(nodeId) {
        const index = this.graph.nodes.findIndex((n) => n.id === nodeId);
        if (index < 0)
            return false;
        this.graph.nodes.splice(index, 1);
        this.graph.edges = this.graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
        this.dirty = true;
        this.save();
        return true;
    }
    /**
     * Get node by ID
     */
    getNode(nodeId) {
        return this.graph.nodes.find((n) => n.id === nodeId);
    }
    /**
     * Get nodes by type
     */
    getNodesByType(type) {
        return this.graph.nodes.filter((n) => n.type === type);
    }
    /**
     * Get edges from/to a node
     */
    getNodeEdges(nodeId) {
        return {
            incoming: this.graph.edges.filter((e) => e.target === nodeId),
            outgoing: this.graph.edges.filter((e) => e.source === nodeId),
        };
    }
    /**
     * Increment usage count
     */
    incrementUsage(nodeId) {
        const node = this.getNode(nodeId);
        if (node) {
            node.usage_count++;
            this.dirty = true;
            this.save();
        }
    }
    /**
     * Update node
     */
    updateNode(nodeId, updates) {
        const node = this.getNode(nodeId);
        if (!node)
            return false;
        Object.assign(node, updates);
        this.dirty = true;
        this.save();
        return true;
    }
    /**
     * Get all nodes
     */
    getAllNodes() {
        return [...this.graph.nodes];
    }
    /**
     * Get all edges
     */
    getAllEdges() {
        return [...this.graph.edges];
    }
    /**
     * Get full graph
     */
    getGraph() {
        return { ...this.graph };
    }
    /**
     * Get nodes sorted by date
     */
    getTimeline(limit) {
        const sorted = [...this.graph.nodes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return limit ? sorted.slice(0, limit) : sorted;
    }
    /**
     * Get recent nodes by type
     */
    getRecent(type, limit = 10) {
        return this.getTimeline()
            .filter((n) => n.type === type)
            .slice(0, limit);
    }
    /**
     * Search nodes
     */
    search(query) {
        const queryLower = query.toLowerCase();
        return this.graph.nodes.filter((n) => n.name.toLowerCase().includes(queryLower) ||
            n.description?.toLowerCase().includes(queryLower));
    }
    /**
     * Get stats
     */
    getStats() {
        const byType = {
            skill: 0,
            memory: 0,
            pattern: 0,
            "anti-pattern": 0,
        };
        const byEdgeType = {
            created_from: 0,
            extends: 0,
            replaces: 0,
            derived_from: 0,
        };
        for (const node of this.graph.nodes) {
            byType[node.type]++;
        }
        for (const edge of this.graph.edges) {
            byEdgeType[edge.type]++;
        }
        const mostUsed = [...this.graph.nodes]
            .sort((a, b) => b.usage_count - a.usage_count)
            .slice(0, 5);
        return {
            totalNodes: this.graph.nodes.length,
            byType,
            totalEdges: this.graph.edges.length,
            byEdgeType,
            mostUsed,
        };
    }
    /**
     * Clear all nodes and edges
     */
    clear() {
        this.graph = this.createEmpty();
        this.dirty = true;
        this.save();
    }
}
// Global instance
let globalGraph = null;
export function getGlobalLearningGraph() {
    if (!globalGraph) {
        globalGraph = new LearningGraphStore();
    }
    return globalGraph;
}
export function createLearningGraph(config) {
    return new LearningGraphStore(config);
}
//# sourceMappingURL=learning-graph.js.map