/**
 * Session Manager - Manager
 *
 * Main session management class.
 */
import type { Message, Session, SessionContext, SessionEvent, SessionEventType, SessionManagerConfig, SessionMetrics, TokenUsage } from "./types.js";
export declare class SessionManager {
    private readonly config;
    private readonly store;
    private readonly policyEngine;
    private readonly contextWindows;
    private eventListeners;
    private cleanupTimer?;
    constructor(config?: SessionManagerConfig);
    /**
     * Generate unique session ID
     */
    private generateId;
    /**
     * Emit session event
     */
    private emit;
    /**
     * Add event listener
     */
    on(eventType: SessionEventType, listener: (event: SessionEvent) => void): void;
    /**
     * Remove event listener
     */
    off(eventType: SessionEventType, listener: (event: SessionEvent) => void): void;
    /**
     * Create a new session
     */
    create(userId: string, metadata?: Record<string, unknown>): Promise<Session>;
    /**
     * Get session
     */
    get(sessionId: string): Promise<Session | null>;
    /**
     * Get session with full context
     */
    getContext(sessionId: string): Promise<SessionContext | null>;
    /**
     * End a session (close it)
     */
    end(sessionId: string): Promise<void>;
    /**
     * Suspend session
     */
    suspend(sessionId: string, reason: string): Promise<void>;
    /**
     * Resume session
     */
    resume(sessionId: string): Promise<Session | null>;
    /**
     * Add message to session
     */
    addMessage(sessionId: string, message: Omit<Message, "id">): Promise<Message | null>;
    /**
     * Get messages for a session
     */
    getMessages(sessionId: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<Message[]>;
    /**
     * Get messages fitting token budget
     */
    getMessagesForContext(sessionId: string, targetTokens: number): Promise<Message[]>;
    /**
     * Update token usage
     */
    updateTokenUsage(sessionId: string, usage: Partial<TokenUsage>): Promise<void>;
    /**
     * Get metrics for a session
     */
    getMetrics(sessionId: string): Promise<SessionMetrics | null>;
    /**
     * Get all sessions for a user
     */
    listByUser(userId: string): Promise<Session[]>;
    /**
     * Delete session
     */
    delete(sessionId: string): Promise<void>;
    /**
     * Cleanup expired sessions
     */
    cleanup(): Promise<number>;
    /**
     * Close manager
     */
    close(): Promise<void>;
}
/**
 * Create a session manager
 */
export declare function createSessionManager(config?: SessionManagerConfig): SessionManager;
//# sourceMappingURL=manager.d.ts.map