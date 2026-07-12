/**
 * Cache Management
 *
 * Provides caching functionality for project analysis results.
 * Caches are keyed by repository revision and configuration file hashes.
 */
import type { CacheKey, ProjectProfile } from "./types.js";
/**
 * Cache options.
 */
export interface CacheOptions {
    /** Cache directory path */
    cacheDir?: string;
    /** Maximum age in milliseconds before cache is considered stale */
    maxAgeMs?: number;
    /** Whether to use cache */
    enabled?: boolean;
}
/**
 * Cache manager for project analysis.
 */
export declare class AnalysisCache {
    private cacheDir;
    private maxAgeMs;
    private enabled;
    constructor(options?: CacheOptions);
    /**
     * Generate cache key from request parameters.
     */
    generateKey(repositoryRoot: string, revision: string, configHash: string): CacheKey;
    /**
     * Get cache file path for a key.
     */
    private getCachePath;
    /**
     * Calculate hash of content.
     */
    calculateHash(content: string): string;
    /**
     * Calculate combined hash from multiple files.
     */
    calculateConfigHash(files: {
        path: string;
        content: string;
    }[]): Promise<string>;
    /**
     * Get cached analysis if available and fresh.
     */
    get(key: CacheKey): Promise<ProjectProfile | null>;
    /**
     * Store analysis in cache.
     */
    set(key: CacheKey, profile: ProjectProfile, hashes: {
        ruleHash: string;
        manifestHash: string;
        configHash: string;
    }): Promise<void>;
    /**
     * Invalidate cache for a specific repository.
     */
    invalidate(repositoryRoot: string): Promise<void>;
    /**
     * Clear all cached analyses.
     */
    clear(): Promise<void>;
    /**
     * Get cache statistics.
     */
    getStats(): Promise<{
        entryCount: number;
        totalSize: number;
        oldestEntry: string | null;
        newestEntry: string | null;
    }>;
}
/**
 * Create a hash of rule files for cache invalidation.
 */
export declare function hashRuleFiles(files: {
    path: string;
    content: string;
}[]): Promise<string>;
/**
 * Create a hash of package manifests for cache invalidation.
 */
export declare function hashManifestFiles(files: {
    path: string;
    content: string;
}[]): Promise<string>;
/**
 * Create a hash of framework configuration files for cache invalidation.
 */
export declare function hashFrameworkConfigFiles(files: {
    path: string;
    content: string;
}[]): Promise<string>;
//# sourceMappingURL=cache.d.ts.map