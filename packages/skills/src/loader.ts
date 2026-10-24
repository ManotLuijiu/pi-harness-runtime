/**
 * Skill Registry
 *
 * Stores and manages skills with progressive disclosure.
 * Based on pi.dev Agent Skills specification.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Skill,
  SkillIndex,
  SkillIndexEntry,
  MatchOptions,
  MatchResult,
  LoadOptions,
  LoadedSkill,
  DEFAULT_SKILLS_CONFIG,
} from "./types.js";
import { parseSkillFile, scanSkillDirectory } from "./parser.js";

// --- Qdrant integration (optional) -----------------------------------------
// Loaded dynamically so skills work without Qdrant configured.
// At runtime, packages/ is resolved from the monorepo root or node_modules.

export interface QdrantSkillPoint {
  id: number;
  name: string;
  description: string;
  body: string;
  text: string;
}

interface QdrantClientLike {
  upsert(collection: string, opts: { wait?: boolean; points: unknown[] }): Promise<void>;
  query(collection: string, opts: {
    query?: { text?: string; model?: string };
    limit?: number;
    with_payload?: boolean;
    filter?: Record<string, unknown>;
  }): Promise<unknown>;
}

interface QdrantEmbedderLike {
  createEmbedding(text: string, apiKey?: string): Promise<{ embedding: number[]; tokens: number }>;
  /** One request for many texts. Absent in an older package build. */
  createEmbeddingsBatch?: (texts: string[], apiKey?: string) => Promise<{ embeddings: number[][]; tokens: number }>;
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
 * The default number of skills one indexing request carries.
 */
const DEFAULT_INDEX_BATCH_SIZE = 32;

/** Resolve the Qdrant skill module path (monorepo sibling or npm package) */
async function resolveQdrantModules(): Promise<{
  createQdrantClient: (cfg: unknown) => { upsert(c: string, o: unknown): Promise<void>; query(c: string, o: unknown): Promise<unknown>; };
  createCollection: (client: unknown, name: string, dims: number) => Promise<void>;
  createEmbedding: (text: string, apiKey?: string) => Promise<{ embedding: number[]; tokens: number }>;
  createEmbeddingsBatch?: (texts: string[], apiKey?: string) => Promise<{ embeddings: number[][]; tokens: number }>;
} | null> {
  // Try the monorepo sibling first (the compiled package, so the module
  // comes from the same build the app ships).
  for (const base of ["../../../packages/qdrant-skills/dist", "../../packages/qdrant-skills/dist"]) {
    try {
      // A dynamic import: this module is ESM, where `require` does not exist.
      const mod = (await import(/* @vite-ignore */ base + "/index.js")) as {
        createQdrantClient: unknown;
        createCollection: unknown;
        createEmbedding: unknown;
        createEmbeddingsBatch?: unknown;
      };
      return mod as Awaited<ReturnType<typeof resolveQdrantModules>>;
    } catch {
      // Try next path
    }
  }
  // Fall back to npm package
  try {
    // The specifier is a variable on purpose: the package is optional and
    // must not be resolved by the type checker.
    const specifier = "@pi-harness/qdrant-skills";
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      createQdrantClient: unknown;
      createCollection: unknown;
      createEmbedding: unknown;
      createEmbeddingsBatch?: unknown;
    };
    return {
      createQdrantClient: (cfg: unknown) => (mod.createQdrantClient as Function)(cfg) as { upsert(c: string, o: unknown): Promise<void>; query(c: string, o: unknown): Promise<unknown> },
      createCollection: mod.createCollection as (client: unknown, name: string, dims: number) => Promise<void>,
      createEmbedding: mod.createEmbedding as (text: string, apiKey?: string) => Promise<{ embedding: number[]; tokens: number }>,
      // Absent in an older package build: the registry falls back to one
      // request per text, still with a bounded concurrency.
      createEmbeddingsBatch: typeof mod.createEmbeddingsBatch === "function"
        ? (mod.createEmbeddingsBatch as (texts: string[], apiKey?: string) => Promise<{ embeddings: number[][]; tokens: number }>)
        : undefined,
    };
  } catch {
    return null;
  }
}

/** Read a key file, returning null if missing or empty */
function readKeyFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const val = readFileSync(path, "utf8").trim();
    return val.length > 5 ? val : null;
  } catch {
    return null;
  }
}

/**
 * Get Qdrant config from env or keys files.
 * Returns null if not configured.
 */
export function getQdrantConfig(): {
  url: string;
  apiKey: string;
  collection: string;
} | null {
  const homedir = process.env.HOME || process.env.USERPROFILE || "/home/user";
  const keysDir = `${homedir}/.pi-harness-runtime/keys`;

  const url =
    process.env.QDRANT_CLUSTER_ENDPOINT ||
    readKeyFile(`${keysDir}/qdrant-cluster-url.txt`);
  const apiKey =
    process.env.QDRANT_API_KEY ||
    readKeyFile(`${keysDir}/qdrant-api-key.txt`);

  if (!url || !apiKey) return null;
  return {
    url,
    apiKey,
    collection: process.env.QDRANT_COLLECTION || "pi-harness-skills",
  };
}

/**
 * Skill Registry - manages loaded and indexed skills
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private index: SkillIndex = { entries: [], loadedAt: 0 };
  private loading: Map<string, Promise<Skill>> = new Map();

  // The vector index. `undefined` means "use Qdrant", `null` means "no index".
  private _indexer: SkillVectorIndexer | null | undefined;
  private _batchSize: number;
  // The skills that still have to be indexed, in registration order.
  private _indexQueue: Array<{ skill: Skill; point: QdrantSkillPoint; hash: number }> = [];
  private _indexFlushRunning = false;
  private _indexFlushScheduled = false;
  // The content hash of the version of a skill that was queued or indexed.
  private _indexedHashes: Map<string, number> = new Map();

  // Qdrant state (lazily initialized on first register if configured)
  private _qdrant: {
    client: QdrantClientLike;
    embedder: QdrantEmbedderLike;
    collection: string;
    ready: boolean;
  } | null = null;
  private _qdrantInitPromise: Promise<void> | null = null;
  private _qdrantInitFailed = false;
  private _qdrantIndexer: SkillVectorIndexer | null = null;

  constructor(options: SkillRegistryOptions = {}) {
    this._indexer = options.indexer;
    this._batchSize = options.batchSize ?? DEFAULT_INDEX_BATCH_SIZE;
  }

  /**
   * Check if Qdrant initialization has failed (useful for diagnostics).
   */
  isQdrantFailed(): boolean {
    return this._qdrantInitFailed;
  }

  /**
   * Whether skills are still queued for the vector index.
   */
  isIndexing(): boolean {
    return this._indexFlushRunning || this._indexQueue.length > 0;
  }

  /**
   * Initialize Qdrant client if configured.
   * Uses a shared init promise to prevent race conditions when multiple
   * skills are registered during initialization.
   */
  private async _ensureQdrant(): Promise<void> {
    // Return existing promise if init is in progress
    if (this._qdrantInitPromise) return this._qdrantInitPromise;

    // Start init and store the promise so concurrent callers can await the same init
    this._qdrantInitPromise = this._doQdrantInit();
    return this._qdrantInitPromise;
  }

  private async _doQdrantInit(): Promise<void> {
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
      await mods.createCollection(client, config.collection, 1536);
      this._qdrant = {
        client,
        embedder: {
          createEmbedding: mods.createEmbedding,
          createEmbeddingsBatch: mods.createEmbeddingsBatch,
        },
        collection: config.collection,
        ready: true,
      };
    } catch (err) {
      console.error("[skills] Qdrant init failed:", err instanceof Error ? err.message : String(err));
      this._qdrantInitFailed = true;
    }
  }

  /** The point of a skill in the vector index. */
  private _toQdrantPoint(skill: Skill): QdrantSkillPoint {
    return {
      id: this._hashId(skill.id),
      name: skill.id,
      description: skill.frontmatter.description,
      body: skill.body.slice(0, 2000),
      text: [skill.id, skill.frontmatter.name, skill.frontmatter.description, skill.body.slice(0, 1500)].join(" "),
    };
  }

  /**
   * The indexer of the registry: the injected one, or the Qdrant cluster.
   */
  private _getIndexer(): SkillVectorIndexer | null {
    if (this._indexer !== undefined) return this._indexer;
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
  private _createQdrantIndexer(): SkillVectorIndexer | null {
    const qdrant = this._qdrant;
    if (!qdrant?.ready) return null;

    return {
      embed: async (texts: string[]): Promise<number[][]> => {
        if (texts.length === 0) return [];
        const batch = qdrant.embedder.createEmbeddingsBatch;
        if (batch) {
          const result = await batch(texts);
          return result.embeddings;
        }
        // An older build without the batch call: one request per text, but
        // the caller keeps the concurrency bounded all the same.
        const embeddings: number[][] = [];
        for (const text of texts) {
          const { embedding } = await qdrant.embedder.createEmbedding(text);
          embeddings.push(embedding);
        }
        return embeddings;
      },
      upsert: async (points: SkillVectorPoint[]): Promise<void> => {
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
  private _scheduleIndex(skill: Skill): void {
    const point = this._toQdrantPoint(skill);
    const hash = this._hashId(point.text);
    if (this._indexedHashes.get(skill.id) === hash) return;

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
  private _scheduleIndexFlush(): void {
    if (this._indexFlushScheduled) return;
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
  private _runIndexFlush(): void {
    if (this._indexFlushRunning) return;
    this._indexFlushRunning = true;

    void this._flushIndexQueue().finally(() => {
      this._indexFlushRunning = false;
      // Skills may have arrived while the flush was running.
      if (this._indexQueue.length > 0) this._scheduleIndexFlush();
    });
  }

  private async _flushIndexQueue(): Promise<void> {
    if (this._indexer === undefined) await this._ensureQdrant();
    const indexer = this._getIndexer();
    if (!indexer) {
      // No vector index: the skills stay usable without vectors.
      this._indexQueue = [];
      return;
    }

    while (this._indexQueue.length > 0) {
      const batch = this._indexQueue.splice(0, this._batchSize);
      try {
        const vectors = await indexer.embed(batch.map((item) => item.point.text));
        const points: SkillVectorPoint[] = [];
        batch.forEach((item, position) => {
          const vector = vectors[position];
          if (!vector || vector.length === 0) return;
          points.push({ id: item.point.id, vector, payload: item.point });
        });
        if (points.length > 0) await indexer.upsert(points);
      } catch {
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

  /** Simple deterministic ID for Qdrant (no bigints needed). */
  private _hashId(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) {
      h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  /**
   * Register a skill (auto-indexes to Qdrant if configured).
   */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
    this.updateIndex(skill);
    // Queue the skill for the vector index without blocking registration.
    this._scheduleIndex(skill);
  }

  /**
   * Unregister a skill by ID
   */
  unregister(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (skill) {
      this.skills.delete(skillId);
      this.index.entries = this.index.entries.filter(
        (e) => e.id !== skillId
      );
      return true;
    }
    return false;
  }

  /**
   * Get a skill by ID
   */
  get(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * List all registered skills
   */
  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill index (lightweight)
   */
  getIndex(): SkillIndex {
    return this.index;
  }

  /**
   * Find skills matching a trigger/query
   */
  find(query: string, options?: MatchOptions): MatchResult[] {
    const results: MatchResult[] = [];
    const threshold = options?.threshold ?? 0.3;
    const queryLower = query.toLowerCase();

    for (const skill of this.skills.values()) {
      // Skip disabled skills if requested
      if (
        !options?.includeDisabled &&
        skill.frontmatter.disable_model_invocation
      ) {
        continue;
      }

      let score = 0;
      const matchedTriggers: string[] = [];

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
          } catch {
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
      if (sortBy === "score") return b.score - a.score;
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
  findBestMatch(query: string, options?: MatchOptions): MatchResult | null {
    const results = this.find(query, { ...options, threshold: 0 });
    return results[0] ?? null;
  }

  // --- Qdrant vector search --------------------------------------------------

  /**
   * Search skills by semantic similarity using Qdrant.
   * Falls back to an empty result if Qdrant is not available.
   *
   * @param query Natural-language query
   * @param limit Max results (default 5)
   * @param threshold Minimum cosine score (default 0.5)
   */
  async findVector(
    query: string,
    limit = 5,
    threshold = 0.5,
  ): Promise<Array<{ skill: Skill; score: number }>> {
    await this._ensureQdrant();
    if (!this._qdrant?.ready) return [];

    try {
      const { embedding } = await this._qdrant.embedder.createEmbedding(query);
      // SAFETY: Qdrant's query() accepts number[] for dense vector search via its internal
      // OpenAPI spec — the float[] overload is not in the generated TypeScript types but
      // the server handles it correctly at runtime.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queryOpts: any = { query: embedding, limit, with_payload: true };
      const raw = await this._qdrant.client.query(this._qdrant.collection, queryOpts) as {
        points?: Array<{ id: number; score: number; payload?: Record<string, unknown> }> };

      const results: Array<{ skill: Skill; score: number }> = [];
      for (const pt of raw.points ?? []) {
        if (pt.score < threshold) continue;
        const name = pt.payload?.name as string | undefined;
        const skill = name ? this.skills.get(name) : undefined;
        if (skill) results.push({ skill, score: pt.score });
      }
      return results;
    } catch (err) {
      console.error("[skills] Qdrant vector search failed:", err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Sync all registered skills to Qdrant.
   * Useful after Qdrant becomes available or collection is rebuilt.
   */
  async syncAllToQdrant(onProgress?: (index: number, total: number) => void): Promise<void> {
    if (this._indexer === undefined) await this._ensureQdrant();
    const indexer = this._getIndexer();
    if (!indexer) return;

    const skills = this.list();
    const total = skills.length;
    let done = 0;
    for (let i = 0; i < total; i += this._batchSize) {
      const batch = skills.slice(i, i + this._batchSize);
      const points = batch.map((skill) => this._toQdrantPoint(skill));
      try {
        const vectors = await indexer.embed(points.map((point) => point.text));
        const payload: SkillVectorPoint[] = [];
        points.forEach((point, position) => {
          const vector = vectors[position];
          if (!vector || vector.length === 0) return;
          payload.push({ id: point.id, vector, payload: point });
        });
        if (payload.length > 0) await indexer.upsert(payload);
      } catch {
        // The vector index is optional — a failed batch does not stop the sync.
      }
      done += batch.length;
      onProgress?.(done, total);
    }
  }

  /** Whether Qdrant is available and ready. */
  get isQdrantReady(): boolean {
    return this._qdrant?.ready ?? false;
  }

  /**
   * Load a skill's full content (progressive disclosure)
   */
  async load(skillId: string, options?: LoadOptions): Promise<LoadedSkill | null> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return null;
    }

    // If already loaded, return cached
    if (skill.loaded && !options?.loadReferences && !options?.loadExamples) {
      return skill as LoadedSkill;
    }

    // Check if already loading
    if (this.loading.has(skillId)) {
      return this.loading.get(skillId) as Promise<Skill>;
    }

    // Load the skill
    const loadPromise = this.loadSkill(skill, options);
    this.loading.set(skillId, loadPromise);

    try {
      const loadedSkill = await loadPromise;
      this.loading.delete(skillId);
      return loadedSkill;
    } catch (err) {
      this.loading.delete(skillId);
      throw err;
    }
  }

  /**
   * Load skill content from disk
   */
  private async loadSkill(
    skill: Skill,
    options?: LoadOptions
  ): Promise<LoadedSkill> {
    const loadedSkill: LoadedSkill = { ...skill };
    const skillMdPath = join(skill.path, "SKILL.md");

    // Re-parse to get fresh content
    if (existsSync(skillMdPath)) {
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
          } catch {
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
          } catch {
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
  private updateIndex(skill: Skill): void {
    // Remove existing entry if present
    this.index.entries = this.index.entries.filter(
      (e) => e.id !== skill.id
    );

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
  clear(): void {
    this.skills.clear();
    this.index = { entries: [], loadedAt: 0 };
    this.loading.clear();
  }

  /**
   * Get count of registered skills
   */
  get size(): number {
    return this.skills.size;
  }

  /**
   * Check if skill exists
   */
  has(skillId: string): boolean {
    return this.skills.has(skillId);
  }
}

/**
 * Create a new skill registry
 */
export function createSkillRegistry(options: SkillRegistryOptions = {}): SkillRegistry {
  return new SkillRegistry(options);
}

/**
 * Global skill registry instance (singleton)
 */
let globalRegistry: SkillRegistry | null = null;

export function getGlobalSkillRegistry(): SkillRegistry {
  if (!globalRegistry) {
    globalRegistry = createSkillRegistry();
  }
  return globalRegistry;
}

export function setGlobalSkillRegistry(registry: SkillRegistry): void {
  globalRegistry = registry;
}
