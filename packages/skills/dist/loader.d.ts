/**
 * Skill Registry
 *
 * Stores and manages skills with progressive disclosure.
 * Based on pi.dev Agent Skills specification.
 */
import type { Skill, SkillIndex, MatchOptions, MatchResult, LoadOptions, LoadedSkill } from "./types.js";
import { type RemoteSkillSource, type RemoteSkillStats } from "./remote-source.js";
export interface QdrantSkillPoint {
    id: number;
    name: string;
    description: string;
    body: string;
    text: string;
}
export interface QdrantClientLike {
    upsert(collection: string, opts: {
        wait?: boolean;
        points: unknown[];
    }): Promise<void>;
    query(collection: string, opts: {
        query?: {
            text?: string;
            model?: string;
        };
        limit?: number;
        with_payload?: boolean;
        filter?: Record<string, unknown>;
    }): Promise<unknown>;
    /** Read the description of a collection. Optional. */
    getCollection?(name: string): Promise<unknown>;
}
export interface QdrantEmbedderLike {
    createEmbedding(text: string, apiKey?: string): Promise<{
        embedding: number[];
        tokens: number;
    }>;
    /** One request for many texts. Absent in an older package build. */
    createEmbeddingsBatch?: (texts: string[], apiKey?: string) => Promise<{
        embeddings: number[][];
        tokens: number;
    }>;
}
/** What the vector store is in this run. */
export type QdrantSkillState = 
/** No Qdrant credentials on this machine. */
"not-configured"
/** The cluster is configured but cannot be reached. */
 | "unavailable"
/** The cluster is reachable but the collection does not exist yet. */
 | "missing"
/** The collection exists but holds no skill. */
 | "empty"
/** The collection holds skills. */
 | "populated";
/** The state of the skill vector store. */
export interface QdrantSkillStats {
    /** What the vector store is in this run. */
    state: QdrantSkillState;
    /** The number of skill vectors in the collection. */
    count: number;
    /** The collection the numbers belong to. */
    collection?: string;
    /** The vector size the collection was created with. */
    dimensions?: number;
    /** The distance the collection was created with. */
    distance?: string;
    /** Why the collection could not be read. Never a credential. */
    error?: string;
    /**
     * The collection does not match the schema of the runtime.
     *
     * The message names the real cause, so a user whose vector search finds
     * nothing does not have to guess why.
     */
    schemaMismatch?: string;
    /**
     * The collection of an earlier installation that still holds the skills.
     *
     * The runtime collection is empty (or does not exist yet) while the
     * legacy collection holds the skills of the previous version. They are
     * not lost - they live in a collection with another name, and one with
     * another vector size.
     */
    legacy?: LegacyCollectionInfo;
}
/**
 * The skills of the legacy collection.
 */
export interface LegacyCollectionInfo {
    /** The name of the collection. */
    collection: string;
    /** The number of skill vectors it holds. */
    count: number;
    /** The vector size it was created with. */
    dimensions?: number;
    /** The embedding model it was created with. */
    model?: string;
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
    /**
     * The Qdrant client.
     *
     * `undefined` (the default) connects to the configured cluster. An object
     * is used as the client - a test uses a double, so the search path can be
     * exercised without a network.
     */
    qdrantClient?: QdrantClientLike;
    /**
     * The embedder that turns a query into a vector.
     *
     * Only used together with an injected client.
     */
    embedder?: QdrantEmbedderLike;
    /**
     * The collection of the injected client.
     *
     * Only used together with an injected client.
     */
    collection?: string;
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
    /** The options of the registry. */
    private _options;
    /**
     * The skills that only exist in the vector store.
     *
     * They are kept apart from the local skills on purpose: `list()` must
     * report the LOCAL skills, so a client can say how many skills it has on
     * disk and how many it can reach through the vector store.
     */
    private remoteSkills;
    /**
     * The remote skills whose content is COMPLETE.
     *
     * A skill that only carries the truncated body of a vector store payload
     * is not in this set - it is completed on the first load.
     */
    private _completeRemote;
    /**
     * The service that holds the server-side skills.
     *
     * `undefined` means "no service is configured".
     */
    private _remoteSource;
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
    /**
     * The skills of the legacy collection.
     *
     * The legacy collection holds 384-dimensional vectors, so it cannot be
     * searched with the vectors of the runtime. Its skills are not lost -
     * they live in a collection with another name.
     */
    private _readLegacyCollection;
    /**
     * The schema the runtime expects of the skill collection.
     *
     * The installed Qdrant package knows the size of its own model; an older
     * build does not, and the fallback is used then.
     */
    private _expectedVectorSchema;
    /**
     * The state of the skill vector store.
     *
     * The numbers are what the startup summary shows next to the local skill
     * count, and the state says WHY there is no number: no credentials, an
     * unreachable cluster, a collection that does not exist yet.
     *
     * The collection schema is checked here as well: a collection built with a
     * different embedding model holds vectors the runtime cannot search with,
     * and the reason has to be named - otherwise the vector search simply
     * finds nothing.
     */
    getQdrantStats(): Promise<QdrantSkillStats>;
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
     * The skills that only exist in the vector store.
     *
     * They are not part of `list()`: the local count must stay local.
     */
    listRemote(): Skill[];
    /**
     * The service that holds the server-side skills.
     *
     * `undefined` means "no service is configured". Setting a source clears
     * the cached remote skills: a new service is a new authority, so the old
     * content must not survive it.
     */
    setRemoteSource(source: RemoteSkillSource | undefined): void;
    /**
     * Ask the service for the skills it holds.
     *
     * A skill whose version changed is replaced by the new one. A record
     * without a version never replaces a cached skill - an unknown version is
     * not evidence of a change.
     */
    refreshRemoteSkills(options?: {
        search?: string;
        limit?: number;
    }): Promise<RemoteSkillStats>;
    /**
     * The state of the service that holds the server-side skills.
     *
     * The states stay apart: a refused call is not an unreachable service and
     * not an empty service.
     */
    getRemoteStats(): Promise<RemoteSkillStats>;
    /**
     * The state a failed call stands for.
     *
     * A refusal of the service is "denied" - the service answered, it just
     * did not allow this call. Everything else is a service that could not be
     * reached.
     */
    private _remoteFailureState;
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
     * A skill that only exists in the vector store.
     *
     * The payload carries the name, the description and the body - enough to
     * USE the skill on a machine that has no local copy of it.
     */
    private static skillFromPayload;
    /**
     * Search skills by semantic similarity using Qdrant.
     * Falls back to an empty result if Qdrant is not available.
     *
     * A hit that belongs to no local skill is a SERVER skill: it is returned
     * with its payload instead of being dropped. Dropping it would make a
     * shared skill invisible on every machine that has no local copy of it -
     * which is exactly the case the vector store exists for.
     *
     * @param query Natural-language query
     * @param limit Max results (default 5)
     * @param threshold Minimum cosine score (default 0.5)
     */
    findVector(query: string, limit?: number, threshold?: number): Promise<Array<{
        skill: Skill;
        score: number;
        source: "local" | "remote";
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