/**
 * Memory Store - Persistent memory for agent notes and user preferences
 *
 * Based on Hermes Agent's memory system:
 * - MEMORY.md: Agent's personal notes (environment facts, conventions, tool quirks)
 * - USER.md: User preferences and patterns (Honcho dialectic modeling)
 *
 * Memory is injected into system prompt at session start.
 */
/**
 * Memory entry for agent notes
 */
export interface MemoryEntry {
    id: string;
    content: string;
    source: "agent" | "user" | "curator";
    created_at: string;
    updated_at: string;
    tags?: string[];
    fingerprint?: string;
}
/**
 * User profile entry
 */
export interface UserProfileEntry {
    id: string;
    content: string;
    category: "preference" | "style" | "workflow" | "context";
    created_at: string;
    updated_at: string;
    confidence: number;
}
/**
 * Memory store configuration
 */
export interface MemoryStoreConfig {
    memoryFile: string;
    userFile: string;
    maxMemoryTokens: number;
}
/**
 * Default memory store configuration
 */
export declare const DEFAULT_MEMORY_CONFIG: MemoryStoreConfig;
/**
 * Memory Store class
 */
export declare class MemoryStore {
    private config;
    private memoryFile;
    private userFile;
    private memoryCache;
    private userCache;
    private dirty;
    constructor(config?: Partial<MemoryStoreConfig>);
    /**
     * Load memory from files
     */
    load(): void;
    /**
     * Load memory entries from file
     */
    private loadMemoryFile;
    /**
     * Load user profile from file
     */
    private loadUserFile;
    /**
     * Parse memory markdown format
     */
    private parseMemoryMarkdown;
    /**
     * Parse user profile markdown format
     */
    private parseUserMarkdown;
    /**
     * Save memory to file
     */
    save(): void;
    /**
     * Serialize memory entries to markdown
     */
    private serializeMemory;
    /**
     * Serialize user entries to markdown
     */
    private serializeUser;
    /**
     * Add memory entry
     */
    addMemory(content: string, source?: MemoryEntry["source"], tags?: string[]): MemoryEntry;
    /**
     * Replace memory entry
     */
    replaceMemory(oldText: string, newContent: string): boolean;
    /**
     * Remove memory entry
     */
    removeMemory(oldText: string): boolean;
    /**
     * Add user profile entry
     */
    addUserProfile(content: string, category?: UserProfileEntry["category"], confidence?: number): UserProfileEntry;
    /**
     * Get all memory entries
     */
    getMemory(): MemoryEntry[];
    /**
     * Get all user profile entries
     */
    getUserProfile(): UserProfileEntry[];
    /**
     * Get memory as system prompt section
     */
    getMemorySection(): string;
    /**
     * Get user preferences as system prompt section
     */
    getUserSection(): string;
    /**
     * Search memory entries
     */
    searchMemory(query: string): MemoryEntry[];
    /**
     * List pending entries (for write approval)
     */
    listPending(): {
        memory: MemoryEntry[];
        user: UserProfileEntry[];
    };
    /**
     * Get approximate token count
     */
    getApproxTokenCount(): number;
    /**
     * Check if memory exceeds max tokens
     */
    isOverTokenLimit(): boolean;
    /**
     * Compact memory (keep most recent/important entries)
     */
    compact(): void;
}
export declare function getGlobalMemoryStore(): MemoryStore;
export declare function createMemoryStore(config?: Partial<MemoryStoreConfig>): MemoryStore;
//# sourceMappingURL=memory-store.d.ts.map