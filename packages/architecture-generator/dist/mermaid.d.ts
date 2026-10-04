/**
 * Architecture Generator - RFC-0073
 *
 * Generate Mermaid diagrams.
 */
import type { ArchitectureDiagram, ArchitectureAnalysis } from './types.js';
/**
 * Generate component diagram
 */
export declare function generateComponentDiagram(analysis: ArchitectureAnalysis): ArchitectureDiagram;
/**
 * Generate sequence diagram
 */
export declare function generateSequenceDiagram(title: string, steps: {
    actor: string;
    action: string;
    target: string;
}[]): ArchitectureDiagram;
/**
 * Generate flow diagram
 */
export declare function generateFlowDiagram(title: string, nodes: {
    id: string;
    label: string;
}[], edges: {
    from: string;
    to: string;
    label?: string;
}[]): ArchitectureDiagram;
//# sourceMappingURL=mermaid.d.ts.map