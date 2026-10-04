/**
 * OKF Indexer (RFC-0106)
 *
 * Parses SKILL.md files and extracts structured knowledge for
 * indexing into TencentDB-Agent-Memory CodeGraph.
 */
/**
 * OKF Document structure
 */
export interface OKFDocument {
    id: string;
    title: string;
    slug: string;
    sections: OKFSection[];
    links: string[];
    metadata: OKFMetadata;
}
export interface OKFSection {
    id: string;
    title: string;
    content: string;
    level: number;
    bullets: string[];
}
export interface OKFMetadata {
    source: string;
    tags: string[];
    created: string;
    updated: string;
    scope?: string;
}
/**
 * Index a single SKILL.md file
 */
export declare function indexSkill(filePath: string, basePath: string): OKFDocument | null;
/**
 * Index all skills in a directory
 */
export declare function indexDirectory(dirPath: string): OKFDocument[];
/**
 * Convert OKF document to CodeGraph nodes/edges for TencentDB
 */
export declare function toCodeGraph(doc: OKFDocument): {
    nodes: Array<{
        id: string;
        type: string;
        data: Record<string, unknown>;
    }>;
    edges: Array<{
        from: string;
        to: string;
        type: string;
    }>;
};
//# sourceMappingURL=indexer.d.ts.map