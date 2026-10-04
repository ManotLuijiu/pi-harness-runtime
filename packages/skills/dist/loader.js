/**
 * Skill Registry
 *
 * Stores and manages skills with progressive disclosure.
 * Based on pi.dev Agent Skills specification.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkillFile } from "./parser.js";
/** Resolve the Qdrant skill module path (monorepo sibling or npm package) */
async function resolveQdrantModules() {
    // Try monorepo sibling first (resolved from packages/skills/src/loader.ts)
    for (const base of ["../../../packages/qdrant-skills/src", "../../packages/qdrant-skills/src"]) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require(/* @vite-ignore */ base + "/index.js");
            return mod;
        }
        catch {
            // Try next path
        }
    }
    // Fall back to npm package
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(/* @vite-ignore */ "@pi-harness/qdrant-skills");
        return {
            createQdrantClient: (cfg) => mod.createQdrantClient(cfg),
            createCollection: mod.createCollection,
            createEmbedding: mod.createEmbedding,
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
    const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
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
        collection: process.env.QDRANT_COLLECTION || "pi-harness-skills",
    };
}
/**
 * Skill Registry - manages loaded and indexed skills
 */
export class SkillRegistry {
    skills = new Map();
    index = { entries: [], loadedAt: 0 };
    loading = new Map();
    // Qdrant state (lazily initialized on first register if configured)
    _qdrant = null;
    _qdrantInitAttempted = false;
    /**
     * Initialize Qdrant client if configured.
     * Called lazily on first skill registration.
     */
    async _ensureQdrant() {
        if (this._qdrantInitAttempted)
            return;
        this._qdrantInitAttempted = true;
        const config = getQdrantConfig();
        if (!config)
            return;
        const mods = await resolveQdrantModules();
        if (!mods) {
            console.debug("[skills] Qdrant package not found — skipping vector indexing");
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
                embedder: { createEmbedding: mods.createEmbedding },
                collection: config.collection,
                ready: true,
            };
        }
        catch (err) {
            console.error("[skills] Qdrant init failed:", err instanceof Error ? err.message : String(err));
        }
    }
    /**
     * Index a single skill into Qdrant (non-blocking).
     */
    async _indexSkillToQdrant(skill) {
        if (!this._qdrant?.ready)
            return;
        const point = {
            id: this._hashId(skill.id),
            name: skill.id,
            description: skill.frontmatter.description,
            body: skill.body.slice(0, 2000),
            text: [skill.id, skill.frontmatter.name, skill.frontmatter.description, skill.body.slice(0, 1500)].join(" "),
        };
        try {
            const { embedding } = await this._qdrant.embedder.createEmbedding(point.text);
            await this._qdrant.client.upsert(this._qdrant.collection, {
                wait: false,
                points: [{ id: point.id, vector: embedding, payload: point }],
            });
        }
        catch {
            // Silently skip — embeddings are optional
        }
    }
    /** Simple deterministic ID for Qdrant (no bigints needed). */
    _hashId(id) {
        let h = 0;
        for (let i = 0; i < id.length; i++) {
            h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
        }
        return Math.abs(h);
    }
    /**
     * Register a skill (auto-indexes to Qdrant if configured).
     */
    register(skill) {
        this.skills.set(skill.id, skill);
        this.updateIndex(skill);
        // Trigger async Qdrant indexing without blocking registration
        this._ensureQdrant().then(() => this._indexSkillToQdrant(skill)).catch(() => { });
    }
    /**
     * Unregister a skill by ID
     */
    unregister(skillId) {
        const skill = this.skills.get(skillId);
        if (skill) {
            this.skills.delete(skillId);
            this.index.entries = this.index.entries.filter((e) => e.id !== skillId);
            return true;
        }
        return false;
    }
    /**
     * Get a skill by ID
     */
    get(skillId) {
        return this.skills.get(skillId);
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
     * Search skills by semantic similarity using Qdrant.
     * Falls back to an empty result if Qdrant is not available.
     *
     * @param query Natural-language query
     * @param limit Max results (default 5)
     * @param threshold Minimum cosine score (default 0.5)
     */
    async findVector(query, limit = 5, threshold = 0.5) {
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
            for (const pt of raw.result?.points ?? []) {
                if (pt.score < threshold)
                    continue;
                const name = pt.payload?.name;
                const skill = name ? this.skills.get(name) : undefined;
                if (skill)
                    results.push({ skill, score: pt.score });
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
        await this._ensureQdrant();
        if (!this._qdrant?.ready)
            return;
        const skills = this.list();
        for (let i = 0; i < skills.length; i++) {
            await this._indexSkillToQdrant(skills[i]);
            onProgress?.(i + 1, skills.length);
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
        const skill = this.skills.get(skillId);
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
        return this.skills.has(skillId);
    }
}
/**
 * Create a new skill registry
 */
export function createSkillRegistry() {
    return new SkillRegistry();
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