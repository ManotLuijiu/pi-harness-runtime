/**
 * Project Analyzer
 *
 * Main analyzer implementation that orchestrates project analysis.
 */
import type { AnalyzeRequest, AnalyzeResult, DetectedLanguage, FrameworkAnalyzerPlugin, ReadonlyFileSystem, TestCapability } from "./types.js";
import { AnalysisCache } from "./cache.js";
/**
 * Default framework analyzer plugins.
 * These are used when no custom plugins are provided.
 */
export declare const DEFAULT_PLUGINS: FrameworkAnalyzerPlugin[];
/**
 * Count language coverage from scanned files.
 */
export declare function detectLanguages(files: {
    relativePath: string;
    size: number;
}[]): DetectedLanguage[];
/**
 * Detect test capabilities from project files.
 */
export declare function detectTestCapabilities(fs: ReadonlyFileSystem, framework: string): Promise<TestCapability[]>;
/**
 * Project analyzer implementation.
 */
export declare class ProjectAnalyzer {
    private cache;
    private plugins;
    private defaultDetector;
    constructor(options?: {
        cache?: AnalysisCache;
        plugins?: FrameworkAnalyzerPlugin[];
    });
    /**
     * Get git revision for a repository.
     */
    private getGitRevision;
    /**
     * Parse JSON file safely.
     */
    private parseJsonFile;
    /**
     * Run framework detection.
     */
    private detectFrameworks;
    /**
     * Discover rules from project.
     */
    private discoverRules;
    /**
     * Discover commands from project.
     */
    private discoverCommands;
    /**
     * Analyze a project.
     */
    analyze(request: AnalyzeRequest): Promise<AnalyzeResult>;
}
/**
 * Create a project analyzer with default configuration.
 */
export declare function createProjectAnalyzer(options?: {
    cache?: AnalysisCache;
    plugins?: FrameworkAnalyzerPlugin[];
}): ProjectAnalyzer;
//# sourceMappingURL=analyzer.d.ts.map