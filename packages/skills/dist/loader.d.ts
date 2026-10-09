/**
 * Skill Registry
 *
 * Stores and manages skills with progressive disclosure.
 * Based on pi.dev Agent Skills specification.
 */
import type { Skill, SkillIndex, MatchOptions, MatchResult, LoadOptions, LoadedSkill } from "./types.js";
/**
 * Get Qdrant config from env or keys files.
 * Returns null if not configured.
 */
export declare function getQdrantConfig(): {
    url: string;
    apiKey: string;
    collection: string;
} | null;
/**
 * Skill Registry - manages loaded and indexed skills
 */
export declare class SkillRegistry {
    private skills;
    private index;
    private loading;
    private _qdrant;
    private _qdrantInitPromise;
    private _qdrantInitFailed;
    /**
     * Check if Qdrant initialization has failed (useful for diagnostics).
     */
    isQdrantFailed(): boolean;
    /**
     * Initialize Qdrant client if configured.
     * Uses a shared init promise to prevent race conditions when multiple
     * skills are registered during initialization.
     */
    private _ensureQdrant;
    private _doQdrantInit;
    /**
     * Index a single skill into Qdrant (non-blocking).
     */
    private _indexSkillToQdrant;
    /** Simple deterministic ID for Qdrant (no bigints needed). */
    private _hashId;
    /**
     * Register a skill (auto-indexes to Qdrant if configured).
     */
    register(skill: Skill): void;
    /**
     * Unregister a skill by ID
     */
    unregister(skillId: string): boolean;
    /**
     * Get a skill by ID
     */
    get(skillId: string): Skill | undefined;
    /**
     * List all registered skills
     */
    list(): Skill[];
    /**
     * Get skill index (lightweight)
     */
    getIndex(): SkillIndex;
    /**
     * Find skills matching a trigger/query
     */
    find(query: string, options?: MatchOptions): MatchResult[];
    /**
     * Find best matching skill for a query
     */
    findBestMatch(query: string, options?: MatchOptions): MatchResult | null;
    /**
     * Search skills by semantic similarity using Qdrant.
     * Falls back to an empty result if Qdrant is not available.
     *
     * @param query Natural-language query
     * @param limit Max results (default 5)
     * @param threshold Minimum cosine score (default 0.5)
     */
    findVector(query: string, limit?: number, threshold?: number): Promise<Array<{
        skill: Skill;
        score: number;
    }>>;
    /**
     * Sync all registered skills to Qdrant.
     * Useful after Qdrant becomes available or collection is rebuilt.
     */
    syncAllToQdrant(onProgress?: (index: number, total: number) => void): Promise<void>;
    /** Whether Qdrant is available and ready. */
    get isQdrantReady(): boolean;
    /**
     * Load a skill's full content (progressive disclosure)
     */
    load(skillId: string, options?: LoadOptions): Promise<LoadedSkill | null>;
    /**
     * Load skill content from disk
     */
    private loadSkill;
    /**
     * Update skill index entry
     */
    private updateIndex;
    /**
     * Clear all skills
     */
    clear(): void;
    /**
     * Get count of registered skills
     */
    get size(): number;
    /**
     * Check if skill exists
     */
    has(skillId: string): boolean;
}
/**
 * Create a new skill registry
 */
export declare function createSkillRegistry(): SkillRegistry;
export declare function getGlobalSkillRegistry(): SkillRegistry;
export declare function setGlobalSkillRegistry(registry: SkillRegistry): void;
//# sourceMappingURL=loader.d.ts.map