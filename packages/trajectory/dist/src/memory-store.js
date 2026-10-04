/**
 * Memory Store - Persistent memory for agent notes and user preferences
 *
 * Based on Hermes Agent's memory system:
 * - MEMORY.md: Agent's personal notes (environment facts, conventions, tool quirks)
 * - USER.md: User preferences and patterns (Honcho dialectic modeling)
 *
 * Memory is injected into system prompt at session start.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
/**
 * Default memory store configuration
 */
export const DEFAULT_MEMORY_CONFIG = {
    memoryFile: "~/.pi-harness/memory/MEMORY.md",
    userFile: "~/.pi-harness/memory/USER.md",
    maxMemoryTokens: 1300,
};
/**
 * Expand ~ in paths
 */
function expandPath(path) {
    if (path.startsWith("~/")) {
        return join(homedir(), path.slice(2));
    }
    return path;
}
/**
 * Generate fingerprint for content deduplication
 */
function generateFingerprint(content) {
    // Simple hash for fingerprinting
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
}
/**
 * Memory Store class
 */
export class MemoryStore {
    config;
    memoryFile;
    userFile;
    memoryCache = [];
    userCache = [];
    dirty = false;
    constructor(config) {
        this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
        this.memoryFile = expandPath(this.config.memoryFile);
        this.userFile = expandPath(this.config.userFile);
        this.load();
    }
    /**
     * Load memory from files
     */
    load() {
        this.memoryCache = this.loadMemoryFile(this.memoryFile);
        this.userCache = this.loadUserFile(this.userFile);
    }
    /**
     * Load memory entries from file
     */
    loadMemoryFile(filePath) {
        if (!existsSync(filePath)) {
            return [];
        }
        try {
            const content = readFileSync(filePath, "utf-8");
            return this.parseMemoryMarkdown(content);
        }
        catch (err) {
            console.error(`[MemoryStore] Failed to load ${filePath}:`, err);
            return [];
        }
    }
    /**
     * Load user profile from file
     */
    loadUserFile(filePath) {
        if (!existsSync(filePath)) {
            return [];
        }
        try {
            const content = readFileSync(filePath, "utf-8");
            return this.parseUserMarkdown(content);
        }
        catch (err) {
            console.error(`[MemoryStore] Failed to load ${filePath}:`, err);
            return [];
        }
    }
    /**
     * Parse memory markdown format
     */
    parseMemoryMarkdown(content) {
        const entries = [];
        const lines = content.split("\n");
        let currentEntry = null;
        let currentContent = [];
        for (const line of lines) {
            // Check for entry separator
            if (line.startsWith("---")) {
                if (currentEntry && currentContent.length > 0) {
                    entries.push({
                        id: currentEntry.id,
                        content: currentContent.join("\n").trim(),
                        source: currentEntry.source || "agent",
                        created_at: currentEntry.created_at,
                        updated_at: currentEntry.updated_at,
                        tags: currentEntry.tags,
                        fingerprint: generateFingerprint(currentContent.join("\n")),
                    });
                }
                currentEntry = {};
                currentContent = [];
                continue;
            }
            // Parse metadata
            if (line.includes(":") && currentEntry) {
                const [key, ...valueParts] = line.split(":");
                const value = valueParts.join(":").trim();
                switch (key.trim()) {
                    case "id":
                        currentEntry.id = value;
                        break;
                    case "source":
                        currentEntry.source = value;
                        break;
                    case "created":
                    case "created_at":
                        currentEntry.created_at = value;
                        break;
                    case "updated":
                    case "updated_at":
                        currentEntry.updated_at = value;
                        break;
                    case "tags":
                        currentEntry.tags = value.split(",").map((t) => t.trim());
                        break;
                }
            }
            else if (currentEntry?.id) {
                currentContent.push(line);
            }
        }
        // Push last entry
        if (currentEntry && currentContent.length > 0) {
            entries.push({
                id: currentEntry.id,
                content: currentContent.join("\n").trim(),
                source: currentEntry.source || "agent",
                created_at: currentEntry.created_at,
                updated_at: currentEntry.updated_at,
                tags: currentEntry.tags,
                fingerprint: generateFingerprint(currentContent.join("\n")),
            });
        }
        return entries;
    }
    /**
     * Parse user profile markdown format
     */
    parseUserMarkdown(content) {
        const entries = [];
        const lines = content.split("\n");
        let currentEntry = null;
        let currentContent = [];
        let currentCategory = "preference";
        for (const line of lines) {
            // Check for category header
            if (line.startsWith("## ")) {
                currentCategory = line.slice(3).trim().toLowerCase();
                continue;
            }
            // Check for entry separator
            if (line.startsWith("---")) {
                if (currentEntry && currentContent.length > 0) {
                    entries.push({
                        id: currentEntry.id,
                        content: currentContent.join("\n").trim(),
                        category: currentEntry.category || currentCategory,
                        created_at: currentEntry.created_at,
                        updated_at: currentEntry.updated_at,
                        confidence: currentEntry.confidence ?? 0.8,
                    });
                }
                currentEntry = {};
                currentContent = [];
                continue;
            }
            // Parse metadata
            if (line.includes(":") && currentEntry) {
                const [key, ...valueParts] = line.split(":");
                const value = valueParts.join(":").trim();
                switch (key.trim()) {
                    case "id":
                        currentEntry.id = value;
                        break;
                    case "confidence":
                        currentEntry.confidence = parseFloat(value);
                        break;
                }
            }
            else if (currentEntry?.id) {
                currentContent.push(line);
            }
        }
        // Push last entry
        if (currentEntry && currentContent.length > 0) {
            entries.push({
                id: currentEntry.id,
                content: currentContent.join("\n").trim(),
                category: currentEntry.category || currentCategory,
                created_at: currentEntry.created_at,
                updated_at: currentEntry.updated_at,
                confidence: currentEntry.confidence ?? 0.8,
            });
        }
        return entries;
    }
    /**
     * Save memory to file
     */
    save() {
        if (!this.dirty)
            return;
        // Ensure directory exists
        const memoryDir = dirname(this.memoryFile);
        mkdirSync(memoryDir, { recursive: true });
        // Write memory file
        writeFileSync(this.memoryFile, this.serializeMemory(), "utf-8");
        // Write user file
        writeFileSync(this.userFile, this.serializeUser(), "utf-8");
        this.dirty = false;
    }
    /**
     * Serialize memory entries to markdown
     */
    serializeMemory() {
        if (this.memoryCache.length === 0) {
            return "# Memory\n\nNo entries yet.\n";
        }
        const lines = ["# Memory", "", "---"];
        for (const entry of this.memoryCache) {
            lines.push(`id: ${entry.id}`);
            lines.push(`source: ${entry.source}`);
            lines.push(`created_at: ${entry.created_at}`);
            lines.push(`updated_at: ${entry.updated_at}`);
            if (entry.tags?.length) {
                lines.push(`tags: ${entry.tags.join(", ")}`);
            }
            lines.push("---");
            lines.push(entry.content);
            lines.push("");
            lines.push("---");
            lines.push("");
        }
        return lines.join("\n");
    }
    /**
     * Serialize user entries to markdown
     */
    serializeUser() {
        const categories = ["preference", "style", "workflow", "context"];
        const lines = ["# User Preferences", ""];
        for (const category of categories) {
            const entries = this.userCache.filter((e) => e.category === category);
            if (entries.length === 0)
                continue;
            lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`, "");
            for (const entry of entries) {
                lines.push(`id: ${entry.id}`);
                lines.push(`confidence: ${entry.confidence}`);
                lines.push("---");
                lines.push(entry.content);
                lines.push("");
            }
        }
        return lines.join("\n");
    }
    /**
     * Add memory entry
     */
    addMemory(content, source = "agent", tags) {
        const now = new Date().toISOString();
        const entry = {
            id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            content,
            source,
            created_at: now,
            updated_at: now,
            tags,
            fingerprint: generateFingerprint(content),
        };
        // Check for duplicate
        const existing = this.memoryCache.findIndex((e) => e.fingerprint === entry.fingerprint);
        if (existing >= 0) {
            // Update existing entry
            this.memoryCache[existing].updated_at = now;
            this.memoryCache[existing].content = content;
            this.dirty = true;
            this.save();
            return this.memoryCache[existing];
        }
        this.memoryCache.push(entry);
        this.dirty = true;
        this.save();
        return entry;
    }
    /**
     * Replace memory entry
     */
    replaceMemory(oldText, newContent) {
        const index = this.memoryCache.findIndex((e) => e.content.includes(oldText));
        if (index < 0) {
            return false;
        }
        this.memoryCache[index].content = newContent;
        this.memoryCache[index].updated_at = new Date().toISOString();
        this.memoryCache[index].fingerprint = generateFingerprint(newContent);
        this.dirty = true;
        this.save();
        return true;
    }
    /**
     * Remove memory entry
     */
    removeMemory(oldText) {
        const index = this.memoryCache.findIndex((e) => e.content.includes(oldText));
        if (index < 0) {
            return false;
        }
        this.memoryCache.splice(index, 1);
        this.dirty = true;
        this.save();
        return true;
    }
    /**
     * Add user profile entry
     */
    addUserProfile(content, category = "preference", confidence = 0.8) {
        const now = new Date().toISOString();
        const entry = {
            id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            content,
            category,
            created_at: now,
            updated_at: now,
            confidence,
        };
        this.userCache.push(entry);
        this.dirty = true;
        this.save();
        return entry;
    }
    /**
     * Get all memory entries
     */
    getMemory() {
        return [...this.memoryCache];
    }
    /**
     * Get all user profile entries
     */
    getUserProfile() {
        return [...this.userCache];
    }
    /**
     * Get memory as system prompt section
     */
    getMemorySection() {
        if (this.memoryCache.length === 0) {
            return "";
        }
        const lines = ["## Agent Memory", ""];
        for (const entry of this.memoryCache) {
            lines.push(`- ${entry.content}`);
            if (entry.tags?.length) {
                lines.push(`  Tags: ${entry.tags.join(", ")}`);
            }
        }
        lines.push("");
        return lines.join("\n");
    }
    /**
     * Get user preferences as system prompt section
     */
    getUserSection() {
        if (this.userCache.length === 0) {
            return "";
        }
        const lines = ["## User Preferences", ""];
        for (const entry of this.userCache) {
            if (entry.confidence < 0.5)
                continue; // Skip low confidence
            lines.push(`- [${entry.category}] ${entry.content}`);
        }
        lines.push("");
        return lines.join("\n");
    }
    /**
     * Search memory entries
     */
    searchMemory(query) {
        const queryLower = query.toLowerCase();
        return this.memoryCache.filter((e) => e.content.toLowerCase().includes(queryLower) ||
            e.tags?.some((t) => t.toLowerCase().includes(queryLower)));
    }
    /**
     * List pending entries (for write approval)
     */
    listPending() {
        return {
            memory: this.memoryCache.filter((e) => e.source === "agent"),
            user: this.userCache,
        };
    }
    /**
     * Get approximate token count
     */
    getApproxTokenCount() {
        const memory = this.serializeMemory();
        const user = this.serializeUser();
        // Rough estimate: 1 token ≈ 4 chars
        return Math.ceil((memory.length + user.length) / 4);
    }
    /**
     * Check if memory exceeds max tokens
     */
    isOverTokenLimit() {
        return this.getApproxTokenCount() > this.config.maxMemoryTokens;
    }
    /**
     * Compact memory (keep most recent/important entries)
     */
    compact() {
        // Sort by updated_at descending, keep top entries
        this.memoryCache.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        // Keep entries until under token limit
        const targetTokens = this.config.maxMemoryTokens * 0.8; // 80% of limit
        const keptEntries = [];
        let tokenCount = 0;
        for (const entry of this.memoryCache) {
            const entryTokens = Math.ceil(entry.content.length / 4);
            if (tokenCount + entryTokens <= targetTokens) {
                keptEntries.push(entry);
                tokenCount += entryTokens;
            }
        }
        this.memoryCache = keptEntries;
        this.dirty = true;
        this.save();
    }
}
// Global memory store instance
let globalMemoryStore = null;
export function getGlobalMemoryStore() {
    if (!globalMemoryStore) {
        globalMemoryStore = new MemoryStore();
    }
    return globalMemoryStore;
}
export function createMemoryStore(config) {
    return new MemoryStore(config);
}
//# sourceMappingURL=memory-store.js.map