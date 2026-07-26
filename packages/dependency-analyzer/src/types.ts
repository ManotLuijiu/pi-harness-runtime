/**
 * Dependency Analyzer — Types
 */

export type DependencyKind = "import" | "export" | "extends" | "implements" | "call" | "reference";

export interface DependencyNode {
	id: string;
	filePath: string;
	kind: DependencyKind;
	imports: string[];
}

export interface DependencyEdge {
	from: string;
	to: string;
	kind: DependencyKind;
	weight: number;
}

export interface DependencyGraph {
	nodes: Map<string, DependencyNode>;
	edges: DependencyEdge[];
	cycles: string[][];
}

export interface DepAnalysisOptions {
	rootPath: string;
	maxDepth?: number;
	excludePatterns?: string[];
	includeDev?: boolean;
}
