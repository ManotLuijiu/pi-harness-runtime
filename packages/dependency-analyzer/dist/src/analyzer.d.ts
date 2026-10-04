/**
 * Dependency Analyzer — Main Analyzer
 */
import type { DependencyGraph } from "./types.js";
export declare class DependencyAnalyzer {
    private rootPath;
    private maxDepth;
    private excludePatterns;
    constructor(rootPath: string);
    analyze(entryFile: string): Promise<DependencyGraph>;
    getStats(graph: DependencyGraph): {
        totalFiles: number;
        totalImports: number;
        cycles: number;
    };
}
//# sourceMappingURL=analyzer.d.ts.map