/**
 * Skill Registry
 *
 * Stores and manages skills with progressive disclosure.
 * Based on pi.dev Agent Skills specification.
 */
import type { Skill, SkillIndex, MatchOptions, MatchResult, LoadOptions, LoadedSkill } from "./types.js";
export interface QdrantSkillPoint {
    id: number;
    name: string;
    description: string;
    body: string;
    text: string;
}
/**
 * A point of the vector index: the vector and the payload of one skill.
 */
export interface SkillVectorPoint {
    id: number;
    vector: number[];
    payload: QdrantSkillPoint;
}
/**
 * The vector index of a registry.
 *
 * The index is an interface so a caller can supply its own implementation
 * (a test uses a counting double) and so the registry never has to know
 * whether the index lives in Qdrant.
 */
export interface SkillVectorIndexer {
    /** One vector per text, in the order of the texts. */
    embed(texts: string[]): Promise<number[][]>;
    /** Store the points of the given skills. */
    upsert(points: SkillVectorPoint[]): Promise<void>;
}
/**
 * The options of a skill registry.
 */
export interface SkillRegistryOptions {
    /**
     * The vector index.
     *
     * `undefined` (the default) indexes into the configured Qdrant cluster.
     * `null` disables the vector index entirely. An object is used as the index.
     */
    indexer?: SkillVectorIndexer | null;
    /**
     * How many skills one indexing request carries. A larger batch costs fewer
     * requests but holds more of them in memory.
     */
    batchSize?: number;
}
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
    private _indexer;
    private _batchSize;
    private _indexQueue;
    private _indexFlushRunning;
    private _indexFlushScheduled;
    private _indexedHashes;
    private _qdrant;
    private _qdrantInitPromise;
    private _qdrantInitFailed;
    private _qdrantIndexer;
    constructor(options?: SkillRegistryOptions);
    /**
     * Check if Qdrant initialization has failed (useful for diagnostics).
     */
    isQdrantFailed(): boolean;
    /**
     * Whether skills are still queued for the vector index.
     */
    isIndexing(): boolean;
    /**
     * Initialize Qdrant client if configured.
     * Uses a shared init promise to prevent race conditions when multiple
     * skills are registered during initialization.
     */
    private _ensureQdrant;
    private _doQdrantInit;
    /** The point of a skill in the vector index. */
    private _toQdrantPoint;
    /**
     * The indexer of the registry: the injected one, or the Qdrant cluster.
     */
    private _getIndexer;
    /**
     * The Qdrant cluster as an indexer.
     *
     * The batch call of the embeddings endpoint carries many texts in one
     * request. One request per skill exhausted the sockets of the process when
     * a registry held hundreds of skills, and every other request of the
     * program then starved.
     */
    private _createQdrantIndexer;
    /**
     * Queue a skill for the vector index.
     *
     * A skill whose text did not change is not queued again: the registry is
     * filled on every scan, and re-embedding the same skill would pay for the
     * same vector over and over.
     */
    private _scheduleIndex;
    /**
     * Start the index flush, a microtask from now.
     *
     * A scan registers every skill in one go. Waiting for the microtask lets
     * that burst share one request instead of starting one request per skill.
     */
    private _scheduleIndexFlush;
    /**
     * Index the queued skills, one batch at a time.
     *
     * Only one batch is in flight, so the number of open connections stays
     * bound no matter how many skills the registry holds.
     */
    private _runIndexFlush;
    private _flushIndexQueue;
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
export declare function createSkillRegistry(options?: SkillRegistryOptions): SkillRegistry;
export declare function getGlobalSkillRegistry(): SkillRegistry;
export declare function setGlobalSkillRegistry(registry: SkillRegistry): void;
//# sourceMappingURL=loader.d.ts.map