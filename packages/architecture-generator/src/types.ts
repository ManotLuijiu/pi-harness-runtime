/**
 * Architecture Generator - RFC-0073
 *
 * Generate ADR and Mermaid diagrams from project analysis.
 */

export type DiagramType = "component" | "flow" | "sequence" | "er" | "class";

export interface ArchitectureDiagram {
	type: DiagramType;
	title: string;
	mermaid: string;
	description?: string;
}

export interface ADR {
	id: string;
	title: string;
	status: "proposed" | "accepted" | "deprecated";
	context: string;
	decision: string;
	consequences: string;
	createdAt: string;
}

export interface ArchitectureAnalysis {
	components: string[];
	dependencies: { from: string; to: string }[];
	layers: string[];
}
