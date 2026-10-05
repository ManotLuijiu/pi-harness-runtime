/**
 * PolicyLoader - Loads and hashes harness and scoped project rules.
 *
 * Responsibilities:
 * - Load the immutable harness policy shipped with the package
 * - Walk from project root toward target file collecting scoped AGENTS.md
 * - Normalize newlines and paths, then hash the ordered mandatory content
 * - Build a PolicyManifest with source paths, scope, priority, and hashes
 */
import type { PolicyManifest } from "./types.js";
/**
 * Policy loader configuration.
 */
export interface PolicyLoaderConfig {
    /** Path to the harness-owned AGENTS.md */
    harnessRulesPath: URL;
    /** Optional additional harness rule files */
    additionalRulesPaths?: URL[];
}
/**
 * Loads and processes agent policies from harness and project sources.
 */
export declare class PolicyLoader {
    private harnessRulesPath;
    private additionalRulesPaths;
    private cache;
    private readonly CACHE_TTL_MS;
    constructor(config: PolicyLoaderConfig);
    /**
     * Load policy for a given project root.
     */
    load(projectRoot: string): Promise<PolicyManifest>;
    /**
     * Load policy for a specific target file (considers scoped rules).
     */
    loadForTarget(projectRoot: string, targetPath?: string): Promise<PolicyManifest>;
    /**
     * Invalidate cache for a project root.
     */
    invalidateCache(projectRoot?: string): void;
    /**
     * Build manifest for a project root.
     */
    private buildManifest;
    /**
     * Load harness-owned rule files.
     */
    private loadHarnessRules;
    /**
     * Load project-owned rule files, walking from root toward target.
     */
    private loadProjectRules;
    /**
     * Evaluate trust level for a project.
     */
    private evaluateTrust;
    /**
     * Infer the scope from a relative path.
     */
    private inferScope;
    /**
     * Normalize content for consistent hashing.
     */
    private normalizeContent;
    /**
     * Compute SHA-256 hash of content.
     */
    private hashContent;
    /**
     * Compute combined revision from sources.
     */
    private computeRevision;
    /**
     * Determine coverage based on loaded sources and errors.
     */
    private determineCoverage;
    /**
     * Generate cache key for a project root.
     */
    private getCacheKey;
    /**
     * Read the raw content of a source file.
     */
    readSourceContent(path: string): string | null;
}
/**
 * Create a PolicyLoader with the standard harness configuration.
 */
export declare function createPolicyLoader(): PolicyLoader;
//# sourceMappingURL=policy-loader.d.ts.map