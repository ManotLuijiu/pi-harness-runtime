/**
 * Framework Detector - Detector
 *
 * Main framework detection engine.
 */
import type { DetectorConfig, ProjectAnalysis, ScanOptions, ScanResult } from "./types.js";
import { SignatureRegistry } from "./signatures/registry.js";
export declare class FrameworkDetector {
    private readonly config;
    private readonly registry;
    private readonly scanCache;
    constructor(config?: DetectorConfig);
    /**
     * Detect frameworks in a project
     */
    detect(projectPath: string): Promise<ProjectAnalysis>;
    /**
     * Scan project files
     */
    scan(options: ScanOptions): Promise<ScanResult>;
    /**
     * Scan directory recursively
     */
    private scanDirectory;
    /**
     * Parse package.json
     */
    private parsePackageJson;
    /**
     * Detect frameworks from scan result
     */
    private detectFrameworks;
    /**
     * Match signature against scan data
     */
    private matchSignature;
    /**
     * Calculate confidence score
     */
    private calculateConfidence;
    /**
     * Determine primary framework
     */
    private determinePrimaryFramework;
    /**
     * Detect programming language
     */
    private detectLanguage;
    /**
     * Detect package manager
     */
    private detectPackageManager;
    /**
     * Resolve framework implications
     */
    private resolveImplications;
    /**
     * Get config type
     */
    private getConfigType;
    /**
     * Clear cache
     */
    clearCache(): void;
    /**
     * Get registry
     */
    getRegistry(): SignatureRegistry;
}
/**
 * Create a framework detector
 */
export declare function createFrameworkDetector(config?: DetectorConfig): FrameworkDetector;
//# sourceMappingURL=detector.d.ts.map