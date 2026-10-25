/**
 * Skill Registry
 *
 * Stores and manages skills with progressive disclosure.
 * Based on pi.dev Agent Skills specification.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkillFile } from "./parser.js";
import { LEGACY_SKILL_COLLECTION, LEGACY_SKILL_COLLECTION_DIMENSIONS, LEGACY_SKILL_COLLECTION_MODEL, SKILL_COLLECTION, SKILL_MIN_SCORE, describeSkillSchemaMismatch, skillPointPayload, skillQdrantPoint, stableHash, } from "./vector-schema.js";
import { skillPointName } from "./sanitize.js";
import { describeRemoteFailure, isStale, skillFromRemote, } from "./remote-source.js";
/**
 * The vector size of the runtime, used when the installed Qdrant package
 * does not report the size of its model.
 *
 * The embedder owns the real value; this is the fallback for an older
 * package build.
 */
const RUNTIME_VECTOR_DIMENSIONS = 1536;
/** The distance of the runtime skill collection. */
const RUNTIME_VECTOR_DISTANCE = "Cosine";
/**
 * The default number of skills one indexing request carries.
 */
const DEFAULT_INDEX_BATCH_SIZE = 32;
/** Resolve the Qdrant skill module path (monorepo sibling or npm package) */
async function resolveQdrantModules() {
    // Try the monorepo sibling first (the compiled package, so the module
    // comes from the same build the app ships).
    for (const base of ["../../../packages/qdrant-skills/dist", "../../packages/qdrant-skills/dist"]) {
        try {
            // A dynamic import: this module is ESM, where `require` does not exist.
            const mod = (await import(/* @vite-ignore */ base + "/index.js"));
            return {
                createQdrantClient: mod.createQdrantClient,
                createCollection: mod.createCollection,
                createEmbedding: mod.createEmbedding,
                // Absent in an older package build: the registry falls back to one
                // request per text, still with a bounded concurrency.
                createEmbeddingsBatch: typeof mod.createEmbeddingsBatch === "function"
                    ? mod.createEmbeddingsBatch
                    : undefined,
                getCollectionInfo: typeof mod.getCollectionInfo === "function"
                    ? mod.getCollectionInfo
                    : undefined,
                embeddingModel: typeof mod.EMBEDDING_MODEL === "string" ? mod.EMBEDDING_MODEL : undefined,
                embeddingDimensions: typeof mod.EMBEDDING_DIMENSIONS === "number" ? mod.EMBEDDING_DIMENSIONS : undefined,
            };
        }
        catch {
            // Try next path
        }
    }
    // Fall back to npm package
    try {
        // The specifier is a variable on purpose: the package is optional and
        // must not be resolved by the type checker.
        const specifier = "@pi-harness/qdrant-skills";
        const mod = (await import(/* @vite-ignore */ specifier));
        return {
            createQdrantClient: mod.createQdrantClient,
            createCollection: mod.createCollection,
            createEmbedding: mod.createEmbedding,
            createEmbeddingsBatch: typeof mod.createEmbeddingsBatch === "function"
                ? mod.createEmbeddingsBatch
                : undefined,
            getCollectionInfo: typeof mod.getCollectionInfo === "function"
                ? mod.getCollectionInfo
                : undefined,
            embeddingModel: typeof mod.EMBEDDING_MODEL === "string" ? mod.EMBEDDING_MODEL : undefined,
            embeddingDimensions: typeof mod.EMBEDDING_DIMENSIONS === "number" ? mod.EMBEDDING_DIMENSIONS : undefined,
        };
    }
    catch {
        return null;
    }
}
/** Read a key file, returning null if missing or empty */
function readKeyFile(path) {
    try {
        if (!existsSync(path))
            return null;
        const val = readFileSync(path, "utf8").trim();
        return val.length > 5 ? val : null;
    }
    catch {
        return null;
    }
}
/**
 * Get Qdrant config from env or keys files.
 * Returns null if not configured.
 */
export function getQdrantConfig() {
    const homedir = process.env.HOME || process.env.USERPROFILE || "/home/user";
    const keysDir = `${homedir}/.pi-harness-runtime/keys`;
    const url = process.env.QDRANT_CLUSTER_ENDPOINT ||
        readKeyFile(`${keysDir}/qdrant-cluster-url.txt`);
    const apiKey = process.env.QDRANT_API_KEY ||
        readKeyFile(`${keysDir}/qdrant-api-key.txt`);
    if (!url || !apiKey)
        return null;
    return {
        url,
        apiKey,
        // The collection carries the model in its name: a collection built with
        // a different embedding model holds vectors of a different size and
        // cannot be searched with these vectors.
        collection: process.env.QDRANT_COLLECTION || SKILL_COLLECTION,
    };
}
/**
 * Skill Registry - manages loaded and indexed skills
 */
export class SkillRegistry {
    skills = new Map();
    /** The options of the registry. */
    _options;
    /**
     * The skills that only exist in the vector store.
     *
     * They are kept apart from the local skills on purpose: `list()` must
     * report the LOCAL skills, so a client can say how many skills it has on
     * disk and how many it can reach through the vector store.
     */
    remoteSkills = new Map();
    /**
     * The local skills by their name in the shared collection.
     *
     * The name of a point is the SANITIZED name of the skill, because the
     * collection is shared. A hit of the collection therefore carries a name
     * that this machine does not use - the registry is keyed by the name on
     * this machine. This map bridges the two.
     */
    _skillsByPointName = new Map();
    /**
     * The remote skills whose content is COMPLETE.
     *
     * A skill that only carries the truncated body of a vector store payload
     * is not in this set - it is completed on the first load.
     */
    _completeRemote = new Set();
    /**
     * The service that holds the server-side skills.
     *
     * `undefined` means "no service is configured".
     */
    _remoteSource;
    index = { entries: [], loadedAt: 0 };
    loading = new Map();
    // The vector index. `undefined` means "use Qdrant", `null` means "no index".
    _indexer;
    _batchSize;
    // The skills that still have to be indexed, in registration order.
    _indexQueue = [];
    _indexFlushRunning = false;
    _indexFlushScheduled = false;
    // The content hash of the version of a skill that was queued or indexed.
    _indexedHashes = new Map();
    // Qdrant state (lazily initialized on first register if configured)
    _qdrant = null;
    _qdrantInitPromise = null;
    _qdrantInitFailed = false;
    _qdrantIndexer = null;
    constructor(options = {}) {
        this._options = options;
        this._indexer = options.indexer;
        this._batchSize = options.batchSize ?? DEFAULT_INDEX_BATCH_SIZE;
    }
    /**
     * Check if Qdrant initialization has failed (useful for diagnostics).
     */
    isQdrantFailed() {
        return this._qdrantInitFailed;
    }
    /**
     * Whether skills are still queued for the vector index.
     */
    isIndexing() {
        return this._indexFlushRunning || this._indexQueue.length > 0;
    }
    /**
     * Initialize Qdrant client if configured.
     * Uses a shared init promise to prevent race conditions when multiple
     * skills are registered during initialization.
     */
    async _ensureQdrant() {
        // Return existing promise if init is in progress
        if (this._qdrantInitPromise)
            return this._qdrantInitPromise;
        // Start init and store the promise so concurrent callers can await the same init
        this._qdrantInitPromise = this._doQdrantInit();
        return this._qdrantInitPromise;
    }
    async _doQdrantInit() {
        // An injected client replaces the whole connection: a test exercises the
        // search path without a network and without credentials.
        const injected = this._options.qdrantClient;
        if (injected) {
            this._qdrant = {
                client: injected,
                embedder: this._options.embedder ?? {
                    createEmbedding: async () => ({ embedding: [], tokens: 0 }),
                },
                collection: this._options.collection ?? "pi-harness-skills-test",
                ready: true,
            };
            return;
        }
        const config = getQdrantConfig();
        if (!config) {
            this._qdrantInitFailed = true;
            return;
        }
        const mods = await resolveQdrantModules();
        if (!mods) {
            console.debug("[skills] Qdrant package not found — skipping vector indexing");
            this._qdrantInitFailed = true;
            return;
        }
        try {
            const client = mods.createQdrantClient({
                url: config.url,
                apiKey: config.apiKey,
            });
            // The collection must hold vectors of the size the embedder produces.
            // An existing collection with a different size is NOT recreated here:
            // that would destroy the skills of another model. The mismatch is
            // reported instead (see getQdrantStats).
            await mods.createCollection(client, config.collection, this._expectedVectorSchema(mods).dimensions);
            this._qdrant = {
                client,
                embedder: {
                    createEmbedding: mods.createEmbedding,
                    createEmbeddingsBatch: mods.createEmbeddingsBatch,
                },
                collection: config.collection,
                ready: true,
            };
        }
        catch (err) {
            console.error("[skills] Qdrant init failed:", err instanceof Error ? err.message : String(err));
            this._qdrantInitFailed = true;
        }
    }
    /**
     * The skills of the legacy collection.
     *
     * The legacy collection holds 384-dimensional vectors, so it cannot be
     * searched with the vectors of the runtime. Its skills are not lost -
     * they live in a collection with another name.
     */
    async _readLegacyCollection(client, mods) {
        // The legacy collection IS the runtime collection when the user
        // configured it explicitly - then there is no second collection.
        if (this._options.collection === LEGACY_SKILL_COLLECTION)
            return undefined;
        if (!mods.getCollectionInfo)
            return undefined;
        try {
            const info = await mods.getCollectionInfo(client, LEGACY_SKILL_COLLECTION);
            if (!info?.exists)
                return undefined;
            const count = info.pointsCount ?? 0;
            if (count === 0)
                return undefined;
            return {
                collection: LEGACY_SKILL_COLLECTION,
                count,
                dimensions: info.vectorsSize,
                model: info.vectorsSize === LEGACY_SKILL_COLLECTION_DIMENSIONS
                    ? LEGACY_SKILL_COLLECTION_MODEL
                    : undefined,
            };
        }
        catch {
            // The legacy collection is a bonus - a failure to read it must not
            // hide the state of the runtime collection.
            return undefined;
        }
    }
    /**
     * The schema the runtime expects of the skill collection.
     *
     * The installed Qdrant package knows the size of its own model; an older
     * build does not, and the fallback is used then.
     */
    _expectedVectorSchema(mods) {
        return {
            dimensions: mods.embeddingDimensions ?? RUNTIME_VECTOR_DIMENSIONS,
            distance: RUNTIME_VECTOR_DISTANCE,
            model: mods.embeddingModel,
        };
    }
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
    async getQdrantStats() {
        const injected = this._options.qdrantClient;
        const config = injected
            ? {
                url: "",
                apiKey: "",
                collection: this._options.collection ?? "pi-harness-skills-test",
            }
            : getQdrantConfig();
        if (!config)
            return { state: "not-configured", count: 0 };
        const mods = await resolveQdrantModules();
        if (!mods) {
            return {
                state: "unavailable",
                count: 0,
                collection: config.collection,
                error: "the Qdrant package is not available",
            };
        }
        if (!mods.getCollectionInfo) {
            return {
                state: "unavailable",
                count: 0,
                collection: config.collection,
                error: "the installed Qdrant package cannot read a collection",
            };
        }
        try {
            const client = injected ?? mods.createQdrantClient({ url: config.url, apiKey: config.apiKey });
            const info = await mods.getCollectionInfo(client, config.collection);
            if (!info) {
                return {
                    state: "unavailable",
                    count: 0,
                    collection: config.collection,
                    error: "the collection could not be read",
                };
            }
            if (!info.exists) {
                // The runtime collection does not exist (yet). An earlier
                // installation may have left the skills in the legacy collection -
                // naming them is more useful than an empty count.
                return {
                    state: "missing",
                    count: 0,
                    collection: config.collection,
                    legacy: await this._readLegacyCollection(client, mods),
                };
            }
            const count = info.pointsCount ?? 0;
            const stats = {
                state: count > 0 ? "populated" : "empty",
                count,
                collection: config.collection,
                dimensions: info.vectorsSize,
                distance: info.vectorsDistance,
            };
            // An empty runtime collection can still have its skills in the
            // legacy one - the same information, one collection further down.
            if (count === 0) {
                stats.legacy = await this._readLegacyCollection(client, mods);
            }
            const mismatch = describeSkillSchemaMismatch({ dimensions: info.vectorsSize, distance: info.vectorsDistance }, this._expectedVectorSchema(mods));
            if (mismatch) {
                stats.schemaMismatch = mismatch;
                // The legacy collection is a known cause - name it, so the reader
                // does not have to know the history of the collection names.
                if (config.collection === LEGACY_SKILL_COLLECTION) {
                    stats.schemaMismatch +=
                        ` - the collection ${LEGACY_SKILL_COLLECTION} was created by scripts/sync-to-qdrant.ts` +
                            ` with ${LEGACY_SKILL_COLLECTION_MODEL} (${LEGACY_SKILL_COLLECTION_DIMENSIONS} dimensions)`;
                }
            }
            return stats;
        }
        catch (err) {
            return {
                state: "unavailable",
                count: 0,
                collection: config.collection,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
    /** The point of a skill in the vector index. */
    _toQdrantPoint(skill) {
        // The payload and the point id come from the shared schema, so the
        // runtime and `scripts/sync-to-qdrant.ts` store the same point for the
        // same skill. A writer that used its own id would leave two points
        // behind - or overwrite an unrelated one.
        const payload = skillPointPayload({
            name: skill.id,
            title: skill.frontmatter.name,
            description: skill.frontmatter.description,
            body: skill.body,
        });
        return skillQdrantPoint(payload);
    }
    /**
     * The indexer of the registry: the injected one, or the Qdrant cluster.
     */
    _getIndexer() {
        if (this._indexer !== undefined)
            return this._indexer;
        if (!this._qdrantIndexer) {
            this._qdrantIndexer = this._createQdrantIndexer();
        }
        return this._qdrantIndexer;
    }
    /**
     * The Qdrant cluster as an indexer.
     *
     * The batch call of the embeddings endpoint carries many texts in one
     * request. One request per skill exhausted the sockets of the process when
     * a registry held hundreds of skills, and every other request of the
     * program then starved.
     */
    _createQdrantIndexer() {
        const qdrant = this._qdrant;
        if (!qdrant?.ready)
            return null;
        return {
            embed: async (texts) => {
                if (texts.length === 0)
                    return [];
                const batch = qdrant.embedder.createEmbeddingsBatch;
                if (batch) {
                    const result = await batch(texts);
                    return result.embeddings;
                }
                // An older build without the batch call: one request per text, but
                // the caller keeps the concurrency bounded all the same.
                const embeddings = [];
                for (const text of texts) {
                    const { embedding } = await qdrant.embedder.createEmbedding(text);
                    embeddings.push(embedding);
                }
                return embeddings;
            },
            upsert: async (points) => {
                await qdrant.client.upsert(qdrant.collection, { wait: false, points });
            },
        };
    }
    /**
     * Queue a skill for the vector index.
     *
     * A skill whose text did not change is not queued again: the registry is
     * filled on every scan, and re-embedding the same skill would pay for the
     * same vector over and over.
     */
    _scheduleIndex(skill) {
        const point = this._toQdrantPoint(skill);
        const hash = stableHash(point.payload.text);
        if (this._indexedHashes.get(skill.id) === hash)
            return;
        this._indexedHashes.set(skill.id, hash);
        this._indexQueue.push({ skill, point, hash });
        this._scheduleIndexFlush();
    }
    /**
     * Start the index flush, a microtask from now.
     *
     * A scan registers every skill in one go. Waiting for the microtask lets
     * that burst share one request instead of starting one request per skill.
     */
    _scheduleIndexFlush() {
        if (this._indexFlushScheduled)
            return;
        this._indexFlushScheduled = true;
        queueMicrotask(() => {
            this._indexFlushScheduled = false;
            this._runIndexFlush();
        });
    }
    /**
     * Index the queued skills, one batch at a time.
     *
     * Only one batch is in flight, so the number of open connections stays
     * bound no matter how many skills the registry holds.
     */
    _runIndexFlush() {
        if (this._indexFlushRunning)
            return;
        this._indexFlushRunning = true;
        void this._flushIndexQueue().finally(() => {
            this._indexFlushRunning = false;
            // Skills may have arrived while the flush was running.
            if (this._indexQueue.length > 0)
                this._scheduleIndexFlush();
        });
    }
    async _flushIndexQueue() {
        if (this._indexer === undefined)
            await this._ensureQdrant();
        const indexer = this._getIndexer();
        if (!indexer) {
            // No vector index: the skills stay usable without vectors.
            this._indexQueue = [];
            return;
        }
        while (this._indexQueue.length > 0) {
            const batch = this._indexQueue.splice(0, this._batchSize);
            try {
                const vectors = await indexer.embed(batch.map((item) => item.point.payload.text));
                const points = [];
                batch.forEach((item, position) => {
                    const vector = vectors[position];
                    if (!vector || vector.length === 0)
                        return;
                    points.push({ id: item.point.id, vector, payload: item.point.payload });
                });
                if (points.length > 0)
                    await indexer.upsert(points);
            }
            catch {
                // The vector index is optional. A failed batch may be retried by a
                // later registration of the same skills.
                for (const item of batch) {
                    if (this._indexedHashes.get(item.skill.id) === item.hash) {
                        this._indexedHashes.delete(item.skill.id);
                    }
                }
            }
        }
    }
    /**
     * Register a skill (auto-indexes to Qdrant if configured).
     */
    register(skill) {
        this.skills.set(skill.id, skill);
        // The shared collection knows the skill by its sanitized name.
        this._skillsByPointName.set(skillPointName(skill.id), skill);
        this.updateIndex(skill);
        // Queue the skill for the vector index without blocking registration.
        this._scheduleIndex(skill);
    }
    /**
     * Unregister a skill by ID
     */
    unregister(skillId) {
        const skill = this.skills.get(skillId);
        if (skill) {
            this.skills.delete(skillId);
            // Only drop the shared name when it still points at this skill: two
            // skills may share a sanitized name.
            const pointName = skillPointName(skill.id);
            if (this._skillsByPointName.get(pointName) === skill) {
                this._skillsByPointName.delete(pointName);
            }
            this.index.entries = this.index.entries.filter((e) => e.id !== skillId);
            return true;
        }
        return false;
    }
    /**
     * Get a skill by ID
     */
    get(skillId) {
        // A server skill is only known after a vector search found it, so it is
        // looked up second - the local skill always wins. The shared name of a
        // skill resolves to the local skill as well.
        return (this.skills.get(skillId) ??
            this._skillsByPointName.get(skillId) ??
            this.remoteSkills.get(skillId));
    }
    /**
     * The skills that only exist in the vector store.
     *
     * They are not part of `list()`: the local count must stay local.
     */
    listRemote() {
        return Array.from(this.remoteSkills.values());
    }
    /**
     * The service that holds the server-side skills.
     *
     * `undefined` means "no service is configured". Setting a source clears
     * the cached remote skills: a new service is a new authority, so the old
     * content must not survive it.
     */
    setRemoteSource(source) {
        this._remoteSource = source;
        this.remoteSkills.clear();
        this._completeRemote.clear();
    }
    /**
     * Ask the service for the skills it holds.
     *
     * A skill whose version changed is replaced by the new one. A record
     * without a version never replaces a cached skill - an unknown version is
     * not evidence of a change.
     */
    async refreshRemoteSkills(options) {
        if (!this._remoteSource) {
            return { state: "not-configured", count: 0 };
        }
        let records;
        try {
            records = await this._remoteSource.list(options);
        }
        catch (error) {
            return {
                state: this._remoteFailureState(error),
                count: 0,
                error: describeRemoteFailure(error),
            };
        }
        for (const record of records) {
            const cached = this.remoteSkills.get(record.id);
            if (!isStale(cached, record))
                continue;
            const skill = skillFromRemote(record);
            this.remoteSkills.set(skill.id, skill);
            if (record.contentComplete)
                this._completeRemote.add(skill.id);
        }
        return {
            state: records.length > 0 ? "populated" : "empty",
            count: records.length,
        };
    }
    /**
     * The state of the service that holds the server-side skills.
     *
     * The states stay apart: a refused call is not an unreachable service and
     * not an empty service.
     */
    async getRemoteStats() {
        if (!this._remoteSource) {
            return { state: "not-configured", count: 0 };
        }
        return this.refreshRemoteSkills();
    }
    /**
     * The state a failed call stands for.
     *
     * A refusal of the service is "denied" - the service answered, it just
     * did not allow this call. Everything else is a service that could not be
     * reached.
     */
    _remoteFailureState(error) {
        const code = error?.code;
        if (code === "denied" || code === -32001 || code === -32002)
            return "denied";
        return "unavailable";
    }
    /**
     * List all registered skills
     */
    list() {
        return Array.from(this.skills.values());
    }
    /**
     * Get skill index (lightweight)
     */
    getIndex() {
        return this.index;
    }
    /**
     * Find skills matching a trigger/query
     */
    find(query, options) {
        const results = [];
        const threshold = options?.threshold ?? 0.3;
        const queryLower = query.toLowerCase();
        for (const skill of this.skills.values()) {
            // Skip disabled skills if requested
            if (!options?.includeDisabled &&
                skill.frontmatter.disable_model_invocation) {
                continue;
            }
            let score = 0;
            const matchedTriggers = [];
            // Check name match
            if (skill.id.toLowerCase().includes(queryLower)) {
                score += 0.8;
                matchedTriggers.push(`name:${skill.id}`);
            }
            // Check description match
            if (skill.frontmatter.description.toLowerCase().includes(queryLower)) {
                score += 0.5;
                matchedTriggers.push("description");
            }
            // Check triggers
            if (skill.hermes?.triggers) {
                for (const trigger of skill.hermes.triggers) {
                    if (trigger.toLowerCase().includes(queryLower)) {
                        score += 0.9;
                        matchedTriggers.push(`trigger:${trigger}`);
                    }
                    // Also check regex-style triggers
                    try {
                        const regex = new RegExp(trigger, "i");
                        if (regex.test(query)) {
                            score += 0.9;
                            matchedTriggers.push(`regex:${trigger}`);
                        }
                    }
                    catch {
                        // Invalid regex, skip
                    }
                }
            }
            // Check tags
            if (skill.hermes?.anti_patterns) {
                for (const anti of skill.hermes.anti_patterns) {
                    if (anti.toLowerCase().includes(queryLower)) {
                        score += 0.3;
                        matchedTriggers.push("anti-pattern");
                    }
                }
            }
            // Usage bonus
            if (skill.hermes?.usage_count && skill.hermes.usage_count > 0) {
                score += Math.min(0.2, skill.hermes.usage_count * 0.01);
            }
            if (score >= threshold) {
                results.push({ skill, score, matchedTriggers });
            }
        }
        // Sort results
        const sortBy = options?.sortBy ?? "score";
        results.sort((a, b) => {
            if (sortBy === "score")
                return b.score - a.score;
            if (sortBy === "usage") {
                const aUsage = a.skill.hermes?.usage_count ?? 0;
                const bUsage = b.skill.hermes?.usage_count ?? 0;
                return bUsage - aUsage;
            }
            return a.skill.id.localeCompare(b.skill.id);
        });
        return results;
    }
    /**
     * Find best matching skill for a query
     */
    findBestMatch(query, options) {
        const results = this.find(query, { ...options, threshold: 0 });
        return results[0] ?? null;
    }
    // --- Qdrant vector search --------------------------------------------------
    /**
     * A skill that only exists in the vector store.
     *
     * The payload carries the name, the description and the body - enough to
     * USE the skill on a machine that has no local copy of it.
     */
    static skillFromPayload(payload, name) {
        const description = typeof payload.description === "string" ? payload.description : "";
        const body = typeof payload.body === "string" ? payload.body : "";
        if (!description && !body)
            return null;
        return {
            id: name,
            // A server skill has no directory on this machine.
            path: "",
            frontmatter: { name, description },
            body,
            references: [],
            examples: [],
            metadata: { name, description },
            loaded: true,
        };
    }
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
     * @param threshold Minimum cosine score (default: the score of the model
     *   of the runtime collection - see SKILL_MIN_SCORE)
     */
    async findVector(query, limit = 5, threshold = SKILL_MIN_SCORE) {
        await this._ensureQdrant();
        if (!this._qdrant?.ready)
            return [];
        try {
            const { embedding } = await this._qdrant.embedder.createEmbedding(query);
            // SAFETY: Qdrant's query() accepts number[] for dense vector search via its internal
            // OpenAPI spec — the float[] overload is not in the generated TypeScript types but
            // the server handles it correctly at runtime.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const queryOpts = { query: embedding, limit, with_payload: true };
            const raw = await this._qdrant.client.query(this._qdrant.collection, queryOpts);
            const results = [];
            for (const pt of raw.points ?? []) {
                if (pt.score < threshold)
                    continue;
                const payload = pt.payload ?? {};
                const name = typeof payload.name === "string" ? payload.name : undefined;
                if (!name)
                    continue;
                const local = this._skillsByPointName.get(name) ?? this.skills.get(name);
                if (local) {
                    results.push({ skill: local, score: pt.score, source: "local" });
                    continue;
                }
                const remote = SkillRegistry.skillFromPayload(payload, name);
                if (!remote)
                    continue;
                this.remoteSkills.set(remote.id, remote);
                results.push({ skill: remote, score: pt.score, source: "remote" });
            }
            return results;
        }
        catch (err) {
            console.error("[skills] Qdrant vector search failed:", err instanceof Error ? err.message : String(err));
            return [];
        }
    }
    /**
     * Sync all registered skills to Qdrant.
     * Useful after Qdrant becomes available or collection is rebuilt.
     */
    async syncAllToQdrant(onProgress) {
        if (this._indexer === undefined)
            await this._ensureQdrant();
        const indexer = this._getIndexer();
        if (!indexer)
            return;
        const skills = this.list();
        const total = skills.length;
        let done = 0;
        for (let i = 0; i < total; i += this._batchSize) {
            const batch = skills.slice(i, i + this._batchSize);
            const points = batch.map((skill) => this._toQdrantPoint(skill));
            try {
                const vectors = await indexer.embed(points.map((point) => point.payload.text));
                const payload = [];
                points.forEach((point, position) => {
                    const vector = vectors[position];
                    if (!vector || vector.length === 0)
                        return;
                    payload.push({ id: point.id, vector, payload: point.payload });
                });
                if (payload.length > 0)
                    await indexer.upsert(payload);
            }
            catch {
                // The vector index is optional — a failed batch does not stop the sync.
            }
            done += batch.length;
            onProgress?.(done, total);
        }
    }
    /** Whether Qdrant is available and ready. */
    get isQdrantReady() {
        return this._qdrant?.ready ?? false;
    }
    /**
     * Load a skill's full content (progressive disclosure)
     */
    async load(skillId, options) {
        let skill = this.skills.get(skillId) ?? this.remoteSkills.get(skillId);
        // A skill that is not known yet may still live on the server. The
        // service decides whether this user may see it - a refusal is not an
        // error, it is an answer.
        if (!skill && this._remoteSource) {
            const record = await this._remoteSource.get(skillId);
            if (!record)
                return null;
            skill = skillFromRemote(record);
            this.remoteSkills.set(skill.id, skill);
            if (record.contentComplete)
                this._completeRemote.add(skill.id);
        }
        // A cached remote skill may carry only a truncated body. The service
        // holds the complete content, so it is fetched once.
        if (skill &&
            !this.skills.has(skillId) &&
            this._remoteSource &&
            !this._completeRemote.has(skillId)) {
            const record = await this._remoteSource.get(skillId);
            if (record) {
                const complete = skillFromRemote(record);
                this.remoteSkills.set(complete.id, complete);
                if (record.contentComplete)
                    this._completeRemote.add(complete.id);
                skill = complete;
            }
        }
        if (!skill) {
            return null;
        }
        // If already loaded, return cached
        if (skill.loaded && !options?.loadReferences && !options?.loadExamples) {
            return skill;
        }
        // Check if already loading
        if (this.loading.has(skillId)) {
            return this.loading.get(skillId);
        }
        // Load the skill
        const loadPromise = this.loadSkill(skill, options);
        this.loading.set(skillId, loadPromise);
        try {
            const loadedSkill = await loadPromise;
            this.loading.delete(skillId);
            return loadedSkill;
        }
        catch (err) {
            this.loading.delete(skillId);
            throw err;
        }
    }
    /**
     * Load skill content from disk
     */
    async loadSkill(skill, options) {
        const loadedSkill = { ...skill };
        // A server skill has no directory on this machine - its body comes from
        // the vector store, so nothing is read from the disk.
        const skillMdPath = skill.path ? join(skill.path, "SKILL.md") : "";
        // Re-parse to get fresh content
        if (skillMdPath && existsSync(skillMdPath)) {
            const parsed = parseSkillFile(skillMdPath);
            loadedSkill.body = parsed.body;
            loadedSkill.frontmatter = parsed.frontmatter;
            loadedSkill.hermes = parsed.hermes;
        }
        // Load references if requested
        if (options?.loadReferences) {
            loadedSkill.referencesContent = new Map();
            for (const ref of skill.references) {
                if (existsSync(ref.path)) {
                    try {
                        const content = readFileSync(ref.path, "utf-8");
                        loadedSkill.referencesContent.set(ref.name, content);
                    }
                    catch {
                        // Skip unreadable files
                    }
                }
            }
        }
        // Load examples if requested
        if (options?.loadExamples) {
            loadedSkill.examplesContent = new Map();
            for (const example of skill.examples) {
                if (existsSync(example.path)) {
                    try {
                        const content = readFileSync(example.path, "utf-8");
                        loadedSkill.examplesContent.set(example.name, content);
                    }
                    catch {
                        // Skip unreadable files
                    }
                }
            }
        }
        // Mark as loaded
        loadedSkill.loaded = true;
        loadedSkill.lastUsed = Date.now();
        // Update usage count
        if (loadedSkill.hermes) {
            loadedSkill.hermes.usage_count =
                (loadedSkill.hermes.usage_count ?? 0) + 1;
        }
        // Update in registry
        this.skills.set(skill.id, loadedSkill);
        return loadedSkill;
    }
    /**
     * Update skill index entry
     */
    updateIndex(skill) {
        // Remove existing entry if present
        this.index.entries = this.index.entries.filter((e) => e.id !== skill.id);
        // Add new entry
        this.index.entries.push({
            id: skill.id,
            name: skill.frontmatter.name,
            description: skill.frontmatter.description,
            path: skill.path,
            version: skill.frontmatter.version,
            triggers: skill.hermes?.triggers,
            loaded: skill.loaded,
        });
        // Update load time
        this.index.loadedAt = Date.now();
    }
    /**
     * Clear all skills
     */
    clear() {
        this.skills.clear();
        this.remoteSkills.clear();
        this.index = { entries: [], loadedAt: 0 };
        this.loading.clear();
    }
    /**
     * Get count of registered skills
     */
    get size() {
        return this.skills.size;
    }
    /**
     * Check if skill exists
     */
    has(skillId) {
        return this.skills.has(skillId) || this.remoteSkills.has(skillId);
    }
}
/**
 * Create a new skill registry
 */
export function createSkillRegistry(options = {}) {
    return new SkillRegistry(options);
}
/**
 * Global skill registry instance (singleton)
 */
let globalRegistry = null;
export function getGlobalSkillRegistry() {
    if (!globalRegistry) {
        globalRegistry = createSkillRegistry();
    }
    return globalRegistry;
}
export function setGlobalSkillRegistry(registry) {
    globalRegistry = registry;
}
//# sourceMappingURL=loader.js.map