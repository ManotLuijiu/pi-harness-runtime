/**
 * Session Manager - History
 *
 * Message history management and search.
 */
import type { Message, MessageSearchFilter, MessageSearchResult } from "./types.js";
export declare class MessageHistory {
    private messages;
    private readonly maxMessages;
    constructor(maxMessages?: number);
    /**
     * Initialize from existing messages
     */
    initialize(messages: Message[]): void;
    /**
     * Get all messages
     */
    getAll(): Message[];
    /**
     * Get messages by role
     */
    getByRole(role: Message["role"]): Message[];
    /**
     * Get recent messages
     */
    getRecent(count: number): Message[];
    /**
     * Get messages in a range
     */
    getRange(start: number, end: number): Message[];
    /**
     * Add a message
     */
    add(message: Omit<Message, "id">): Message;
    /**
     * Update a message
     */
    update(messageId: string, updates: Partial<Message>): Message | null;
    /**
     * Delete a message
     */
    delete(messageId: string): boolean;
    /**
     * Clear all messages
     */
    clear(): void;
    /**
     * Get message count
     */
    count(): number;
    /**
     * Trim oldest messages
     */
    private trimOldest;
    /**
     * Generate unique message ID
     */
    private generateId;
    /**
     * Export messages as array
     */
    toArray(): Message[];
    /**
     * Get token count estimate
     */
    getEstimatedTokenCount(): number;
}
export declare class MessageSearch {
    private index;
    /**
     * Build index from session
     */
    buildIndex(sessionId: string, messages: Message[]): void;
    /**
     * Search messages
     */
    search(filter: MessageSearchFilter): MessageSearchResult[];
    /**
     * Calculate relevance score
     */
    private calculateScore;
    /**
     * Clear index
     */
    clear(): void;
    /**
     * Remove session from index
     */
    removeSession(sessionId: string): void;
}
export declare class ContextWindowManager {
    private readonly maxTokens;
    private history;
    constructor(maxTokens?: number);
    /**
     * Initialize with messages
     */
    initialize(messages: Message[]): void;
    /**
     * Get messages that fit within token budget
     */
    getMessagesForContext(targetTokens: number): Message[];
    /**
     * Estimate tokens for a message
     */
    private estimateTokens;
    /**
     * Check if context would exceed window
     */
    wouldExceed(newMessageTokens: number): boolean;
    /**
     * Get remaining tokens
     */
    getRemainingTokens(): number;
    /**
     * Get all messages
     */
    getAll(): Message[];
    /**
     * Add message
     */
    add(message: Omit<Message, "id">): Message;
}
//# sourceMappingURL=history.d.ts.map