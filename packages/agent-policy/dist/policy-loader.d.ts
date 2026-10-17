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
     * Resolves applicable rules from workspace toward the target directory.
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
     * Check if harness rules should apply to a given project root.
     * Harness rules only apply when working inside the harness repository itself,
     * not when shipped to user projects.
     */
    private harnessRulesApplyTo;
    /**
     * Load harness-owned rule files.
     * Only loads when working inside the harness repository itself.
     */
    private loadHarnessRules;
    /**
     * Load project-owned rule files, walking from root toward target.
     */
    private loadProjectRules;
    /**
     * Evaluate trust level for a project.
     *
     * NOTE: Trust should ultimately be determined by host authorization (ctx.isProjectTrusted()),
     * not by file presence alone. This method provides a fallback assessment.
     * The presence of .git or package.json indicates a repository but does not confer trust
     * without host authorization.
     */
    private evaluateTrust;
    /**
     * Check if project has explicit trust from host.
     * This should be called with host authorization state.
     */
    hasExplicitTrust(projectRoot: string): boolean;
    /**
     * Infer the scope from a relative path.
     */
    private _inferScope;
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