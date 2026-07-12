/**
 * Session Manager - History
 *
 * Message history management and search.
 */
import { createHash } from "node:crypto";
// ─── Message History ──────────────────────────────────────────────────────
export class MessageHistory {
    messages = [];
    maxMessages;
    constructor(maxMessages = 1000) {
        this.maxMessages = maxMessages;
    }
    /**
     * Initialize from existing messages
     */
    initialize(messages) {
        this.messages = [...messages];
    }
    /**
     * Get all messages
     */
    getAll() {
        return [...this.messages];
    }
    /**
     * Get messages by role
     */
    getByRole(role) {
        return this.messages.filter((m) => m.role === role);
    }
    /**
     * Get recent messages
     */
    getRecent(count) {
        return this.messages.slice(-count);
    }
    /**
     * Get messages in a range
     */
    getRange(start, end) {
        return this.messages.slice(start, end);
    }
    /**
     * Add a message
     */
    add(message) {
        const fullMessage = {
            ...message,
            id: this.generateId(),
        };
        this.messages.push(fullMessage);
        // Trim if over limit
        if (this.messages.length > this.maxMessages) {
            this.trimOldest(this.messages.length - this.maxMessages);
        }
        return fullMessage;
    }
    /**
     * Update a message
     */
    update(messageId, updates) {
        const index = this.messages.findIndex((m) => m.id === messageId);
        if (index === -1)
            return null;
        this.messages[index] = {
            ...this.messages[index],
            ...updates,
            id: messageId, // Preserve ID
        };
        return this.messages[index];
    }
    /**
     * Delete a message
     */
    delete(messageId) {
        const index = this.messages.findIndex((m) => m.id === messageId);
        if (index === -1)
            return false;
        this.messages.splice(index, 1);
        return true;
    }
    /**
     * Clear all messages
     */
    clear() {
        this.messages = [];
    }
    /**
     * Get message count
     */
    count() {
        return this.messages.length;
    }
    /**
     * Trim oldest messages
     */
    trimOldest(count) {
        this.messages.splice(0, count);
    }
    /**
     * Generate unique message ID
     */
    generateId() {
        return createHash("sha256")
            .update(`${Date.now()}-${Math.random()}`)
            .digest("hex")
            .slice(0, 16);
    }
    /**
     * Export messages as array
     */
    toArray() {
        return [...this.messages];
    }
    /**
     * Get token count estimate
     */
    getEstimatedTokenCount() {
        // Rough estimate: 4 characters per token
        return this.messages.reduce((total, msg) => {
            return total + Math.ceil((msg.content.length + msg.role.length) / 4);
        }, 0);
    }
}
// ─── Message Search ────────────────────────────────────────────────────────
export class MessageSearch {
    index = new Map();
    /**
     * Build index from session
     */
    buildIndex(sessionId, messages) {
        this.index.set(sessionId, [...messages]);
    }
    /**
     * Search messages
     */
    search(filter) {
        const { role, contains, limit = 50 } = filter;
        // Get messages for this session
        let messages = [];
        if (filter.sessionId) {
            messages = this.index.get(filter.sessionId) || [];
        }
        else {
            // Search across all sessions
            for (const sessionMessages of this.index.values()) {
                messages.push(...sessionMessages);
            }
        }
        // Apply filters
        let results = messages;
        if (role) {
            results = results.filter((m) => m.role === role);
        }
        if (contains) {
            const searchLower = contains.toLowerCase();
            results = results.filter((m) => m.content.toLowerCase().includes(searchLower));
        }
        if (filter.startDate) {
            const startTime = new Date(filter.startDate).getTime();
            results = results.filter((m) => new Date(m.timestamp).getTime() >= startTime);
        }
        if (filter.endDate) {
            const endTime = new Date(filter.endDate).getTime();
            results = results.filter((m) => new Date(m.timestamp).getTime() <= endTime);
        }
        // Sort by timestamp descending (newest first)
        results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        // Apply pagination
        const offset = filter.offset ?? 0;
        results = results.slice(offset, offset + limit);
        // Convert to search results with scores
        return results.map((m) => ({
            sessionId: filter.sessionId || "",
            messageId: m.id,
            content: m.content,
            timestamp: m.timestamp,
            score: contains ? this.calculateScore(m.content, contains) : 1,
        }));
    }
    /**
     * Calculate relevance score
     */
    calculateScore(content, query) {
        const contentLower = content.toLowerCase();
        const queryLower = query.toLowerCase();
        let score = 0;
        // Exact match
        if (contentLower.includes(queryLower)) {
            score += 1;
        }
        // Word matches
        const words = queryLower.split(/\s+/);
        for (const word of words) {
            if (contentLower.includes(word)) {
                score += 0.5;
            }
        }
        return score;
    }
    /**
     * Clear index
     */
    clear() {
        this.index.clear();
    }
    /**
     * Remove session from index
     */
    removeSession(sessionId) {
        this.index.delete(sessionId);
    }
}
// ─── Context Window Manager ────────────────────────────────────────────────
export class ContextWindowManager {
    maxTokens;
    history;
    constructor(maxTokens = 128000) {
        this.maxTokens = maxTokens;
        this.history = new MessageHistory();
    }
    /**
     * Initialize with messages
     */
    initialize(messages) {
        this.history.initialize(messages);
    }
    /**
     * Get messages that fit within token budget
     */
    getMessagesForContext(targetTokens) {
        const allMessages = this.history.getAll();
        const result = [];
        let tokenCount = 0;
        // Work backwards from most recent
        for (let i = allMessages.length - 1; i >= 0; i--) {
            const msg = allMessages[i];
            const msgTokens = this.estimateTokens(msg);
            if (tokenCount + msgTokens <= targetTokens) {
                result.unshift(msg);
                tokenCount += msgTokens;
            }
            else {
                break;
            }
        }
        return result;
    }
    /**
     * Estimate tokens for a message
     */
    estimateTokens(message) {
        // Rough estimate: 4 characters per token + overhead for metadata
        const contentTokens = Math.ceil(message.content.length / 4);
        const overheadTokens = 10; // Role, timestamp, etc.
        return contentTokens + overheadTokens;
    }
    /**
     * Check if context would exceed window
     */
    wouldExceed(newMessageTokens) {
        const currentTokens = this.history.getEstimatedTokenCount();
        return currentTokens + newMessageTokens > this.maxTokens;
    }
    /**
     * Get remaining tokens
     */
    getRemainingTokens() {
        const currentTokens = this.history.getEstimatedTokenCount();
        return Math.max(0, this.maxTokens - currentTokens);
    }
    /**
     * Get all messages
     */
    getAll() {
        return this.history.getAll();
    }
    /**
     * Add message
     */
    add(message) {
        return this.history.add(message);
    }
}
//# sourceMappingURL=history.js.map