/**
 * Session Manager - Store
 *
 * Session persistence to disk with indexing.
 */
import type { Session, SessionContext, SessionStoreConfig, SessionStatus } from "./types.js";
export declare class SessionStore {
    private readonly rootDir;
    private readonly autoSave;
    private readonly autoSaveIntervalMs;
    private readonly maxSessions?;
    /**
     * Get max sessions limit
     */
    getMaxSessions(): number | undefined;
    private indices;
    private autoSaveTimers;
    constructor(config: SessionStoreConfig);
    /**
     * Ensure directory exists
     */
    private ensureDir;
    /**
     * Get session directory
     */
    private sessionDir;
    /**
     * Get session file path
     */
    private sessionPath;
    /**
     * Get index file path
     */
    private indexPath;
    /**
     * Load or create index
     */
    private loadIndex;
    /**
     * Save index
     */
    private saveIndex;
    /**
     * Save session context to disk
     */
    private saveToDisk;
    /**
     * Load session context from disk
     */
    private loadFromDisk;
    /**
     * Create or update session index entry
     */
    private updateIndexEntry;
    /**
     * Initialize the store
     */
    initialize(): Promise<void>;
    /**
     * Save session context
     */
    save(context: SessionContext): Promise<void>;
    /**
     * Schedule auto-save for a session
     */
    private scheduleAutoSave;
    /**
     * Load session context
     */
    load(sessionId: string): Promise<SessionContext | null>;
    /**
     * Delete session
     */
    delete(sessionId: string): Promise<void>;
    /**
     * List sessions for a user
     */
    listByUser(userId: string): Promise<Session[]>;
    /**
     * List all sessions
     */
    listAll(): Promise<Session[]>;
    /**
     * Get session summary without loading full context
     */
    getSummary(sessionId: string): Promise<Session | null>;
    /**
     * Check if session exists
     */
    exists(sessionId: string): Promise<boolean>;
    /**
     * Get session count
     */
    count(): Promise<number>;
    /**
     * Get sessions by status
     */
    listByStatus(status: SessionStatus): Promise<Session[]>;
    /**
     * Close store and cleanup
     */
    close(): Promise<void>;
}
/**
 * Create a session store
 */
export declare function createSessionStore(config: SessionStoreConfig): SessionStore;
//# sourceMappingURL=store.d.ts.map