/**
 * Scope Discovery
 *
 * Discovers and estimates the scope of refactoring work.
 */
/**
 * File pattern matcher
 */
export interface FilePattern {
    /** Glob pattern or exact extension */
    pattern: string;
    /** Whether to recurse into directories */
    recursive?: boolean;
}
/**
 * Scope discovery configuration
 */
export interface ScopeDiscoveryConfig {
    /** File extensions to consider relevant */
    relevantExtensions: string[];
    /** Directories to exclude (vendored, generated, etc.) */
    excludeDirs: string[];
    /** Files to exclude by name */
    excludeFiles: string[];
    /** Whether to scan for call sites */
    scanCallSites: boolean;
    /** Call site patterns to count */
    callSitePatterns: string[];
}
/**
 * Default scope discovery config
 */
export declare const DEFAULT_SCOPE_CONFIG: ScopeDiscoveryConfig;
/**
 * Discovered scope result
 */
export interface DiscoveredScope {
    /** Total relevant files found */
    totalFiles: number;
    /** Files matching the refactoring pattern */
    matchingFiles: number;
    /** Estimated call sites */
    callSites: number;
    /** Independent components found */
    components: string[];
    /** File breakdown by type */
    fileTypes: Record<string, number>;
    /** Whether shared APIs were detected */
    hasSharedApis: boolean;
    /** Whether transformation appears mechanical */
    isMechanical: boolean;
    /** Scope fingerprint for change detection */
    fingerprint: string;
}
/**
 * Discover scope by scanning files
 */
export declare function discoverScope(workspacePath: string, searchPattern: string, config?: Partial<ScopeDiscoveryConfig>): DiscoveredScope;
/**
 * Quick scope estimate using git grep
 */
export declare function quickScopeEstimate(workspacePath: string, pattern: string): {
    fileCount: number;
    lineCount: number;
};
