/**
 * Knowledge Graph - RFC-0106
 *
 * Extract nodes and edges from SKILL.md files.
 */
import type { KnowledgeNode, KnowledgeEdge, KnowledgeGraph } from './types.js';
/**
 * Extract a knowledge node from a SKILL.md file
 */
export declare function extractSkillNode(filePath: string, content: string, frontmatter: Record<string, unknown>): KnowledgeNode;
/**
 * Extract edges from a SKILL.md file
 */
export declare function extractSkillEdges(filePath: string, content: string, frontmatter: Record<string, unknown>): KnowledgeEdge[];
/**
 * Extract RFC nodes from RFC markdown files
 */
export declare function extractRFCNode(filePath: string, content: string, title: string): KnowledgeNode;
/**
 * Extract edges between RFCs
 */
export declare function extractRFCEdges(filePath: string, content: string): KnowledgeEdge[];
/**
 * Build complete knowledge graph from directory
 */
export declare function extractKnowledgeGraph(skillsPath: string, rfcPath: string): Promise<KnowledgeGraph>;
//# sourceMappingURL=graph-extractor.d.ts.map