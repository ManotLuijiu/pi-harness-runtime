/**
 * Session Manager - Store
 *
 * Session persistence to disk with indexing.
 */
import { readdir, readFile, writeFile, mkdir, rename, unlink, } from "node:fs/promises";
import { dirname, join } from "node:path";
// ─── Session Store ────────────────────────────────────────────────────────
export class SessionStore {
    rootDir;
    autoSave;
    autoSaveIntervalMs;
    maxSessions;
    /**
     * Get max sessions limit
     */
    getMaxSessions() {
        return this.maxSessions;
    }
    indices = new Map();
    autoSaveTimers = new Map();
    constructor(config) {
        this.rootDir = config.rootDir;
        this.autoSave = config.autoSave;
        this.autoSaveIntervalMs = config.autoSaveIntervalMs;
        this.maxSessions = config.maxSessions;
    }
    /**
     * Ensure directory exists
     */
    async ensureDir(dir) {
        await mkdir(dir, { recursive: true });
    }
    /**
     * Get session directory
     */
    sessionDir(sessionId) {
        return join(this.rootDir, "sessions", sessionId.slice(0, 2), sessionId);
    }
    /**
     * Get session file path
     */
    sessionPath(sessionId) {
        return join(this.sessionDir(sessionId), "session.json");
    }
    /**
     * Get index file path
     */
    indexPath() {
        return join(this.rootDir, "sessions", "index.json");
    }
    /**
     * Load or create index
     */
    async loadIndex() {
        const path = this.indexPath();
        try {
            const content = await readFile(path, "utf-8");
            const entries = JSON.parse(content);
            return new Map(entries.map((e) => [e.id, e]));
        }
        catch {
            return new Map();
        }
    }
    /**
     * Save index
     */
    async saveIndex() {
        const entries = Array.from(this.indices.values());
        await this.ensureDir(dirname(this.indexPath()));
        await writeFile(this.indexPath(), JSON.stringify(entries, null, 2), "utf-8");
    }
    /**
     * Save session context to disk
     */
    async saveToDisk(context) {
        const path = this.sessionPath(context.id);
        await this.ensureDir(dirname(path));
        const tmp = `${path}.tmp`;
        await writeFile(tmp, JSON.stringify(context, null, 2), "utf-8");
        await rename(tmp, path);
    }
    /**
     * Load session context from disk
     */
    async loadFromDisk(sessionId) {
        const path = this.sessionPath(sessionId);
        try {
            const content = await readFile(path, "utf-8");
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    /**
     * Create or update session index entry
     */
    updateIndexEntry(context) {
        this.indices.set(context.id, {
            id: context.id,
            userId: context.userId,
            status: context.status,
            createdAt: context.createdAt,
            updatedAt: context.updatedAt,
            expiresAt: context.expiresAt,
            messageCount: context.messages.length,
            totalTokens: context.tokenUsage.totalTokens,
        });
    }
    /**
     * Initialize the store
     */
    async initialize() {
        await this.ensureDir(this.rootDir);
        this.indices = await this.loadIndex();
    }
    /**
     * Save session context
     */
    async save(context) {
        this.updateIndexEntry(context);
        await this.saveToDisk(context);
        if (this.autoSave) {
            this.scheduleAutoSave(context.id);
        }
        // Save index periodically
        await this.saveIndex();
    }
    /**
     * Schedule auto-save for a session
     */
    scheduleAutoSave(sessionId) {
        // Clear existing timer
        const existing = this.autoSaveTimers.get(sessionId);
        if (existing) {
            clearTimeout(existing);
        }
        // Schedule new save
        const timer = setTimeout(async () => {
            this.autoSaveTimers.delete(sessionId);
            const context = await this.loadFromDisk(sessionId);
            if (context) {
                await this.saveToDisk(context);
            }
        }, this.autoSaveIntervalMs);
        this.autoSaveTimers.set(sessionId, timer);
    }
    /**
     * Load session context
     */
    async load(sessionId) {
        return this.loadFromDisk(sessionId);
    }
    /**
     * Delete session
     */
    async delete(sessionId) {
        // Cancel auto-save
        const timer = this.autoSaveTimers.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            this.autoSaveTimers.delete(sessionId);
        }
        // Remove from index
        this.indices.delete(sessionId);
        // Delete files
        const dir = this.sessionDir(sessionId);
        try {
            const files = await readdir(dir);
            await Promise.all(files.map((f) => unlink(join(dir, f))));
        }
        catch {
            // Ignore if directory doesn't exist
        }
        // Update index
        await this.saveIndex();
    }
    /**
     * List sessions for a user
     */
    async listByUser(userId) {
        const entries = Array.from(this.indices.values()).filter((e) => e.userId === userId);
        return entries.map((e) => ({
            id: e.id,
            userId: e.userId,
            status: e.status,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
            lastActivityAt: e.updatedAt,
            expiresAt: e.expiresAt,
        }));
    }
    /**
     * List all sessions
     */
    async listAll() {
        const entries = Array.from(this.indices.values());
        return entries.map((e) => ({
            id: e.id,
            userId: e.userId,
            status: e.status,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
            lastActivityAt: e.updatedAt,
            expiresAt: e.expiresAt,
        }));
    }
    /**
     * Get session summary without loading full context
     */
    async getSummary(sessionId) {
        const entry = this.indices.get(sessionId);
        if (!entry)
            return null;
        return {
            id: entry.id,
            userId: entry.userId,
            status: entry.status,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            lastActivityAt: entry.updatedAt,
            expiresAt: entry.expiresAt,
        };
    }
    /**
     * Check if session exists
     */
    async exists(sessionId) {
        return this.indices.has(sessionId);
    }
    /**
     * Get session count
     */
    async count() {
        return this.indices.size;
    }
    /**
     * Get sessions by status
     */
    async listByStatus(status) {
        const entries = Array.from(this.indices.values()).filter((e) => e.status === status);
        return entries.map((e) => ({
            id: e.id,
            userId: e.userId,
            status: e.status,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
            lastActivityAt: e.updatedAt,
            expiresAt: e.expiresAt,
        }));
    }
    /**
     * Close store and cleanup
     */
    async close() {
        // Clear all auto-save timers
        for (const timer of this.autoSaveTimers.values()) {
            clearTimeout(timer);
        }
        this.autoSaveTimers.clear();
        // Save final index
        await this.saveIndex();
    }
}
// ─── Factory Function ────────────────────────────────────────────────────
/**
 * Create a session store
 */
export function createSessionStore(config) {
    return new SessionStore(config);
}
//# sourceMappingURL=store.js.map