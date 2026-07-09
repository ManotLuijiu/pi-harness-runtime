/**
 * Session Manager - Manager
 *
 * Main session management class.
 */
import { randomBytes } from "node:crypto";
import { ContextWindowManager } from "./history.js";
import { PolicyEngine } from "./policy.js";
import { SessionStore } from "./store.js";
// ─── Default Configuration ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    rootDir: "./sessions",
    sessionTtlMs: 24 * 60 * 60 * 1000,
    maxIdleMs: 30 * 60 * 1000,
    autoSaveIntervalMs: 5000,
    maxMessagesPerSession: 1000,
    maxTokenBudget: 128000,
    enableMetrics: true,
    autoCleanup: true,
    cleanupIntervalMs: 60 * 60 * 1000, // 1 hour
};
// ─── Session Manager ───────────────────────────────────────────────────────
export class SessionManager {
    config;
    store;
    policyEngine;
    contextWindows = new Map();
    eventListeners = new Map();
    cleanupTimer;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.store = new SessionStore({
            rootDir: this.config.rootDir,
            autoSave: true,
            autoSaveIntervalMs: this.config.autoSaveIntervalMs,
        });
        this.policyEngine = new PolicyEngine();
        // Start cleanup timer
        if (this.config.autoCleanup) {
            this.cleanupTimer = setInterval(() => this.cleanup().catch(console.error), this.config.cleanupIntervalMs);
        }
    }
    /**
     * Generate unique session ID
     */
    generateId() {
        return randomBytes(16).toString("hex");
    }
    /**
     * Emit session event
     */
    emit(type, sessionId, data) {
        const event = {
            type,
            sessionId,
            timestamp: new Date().toISOString(),
            data,
        };
        const listeners = this.eventListeners.get(type);
        if (listeners) {
            for (const listener of listeners) {
                try {
                    listener(event);
                }
                catch (err) {
                    console.error("Event listener error:", err);
                }
            }
        }
    }
    /**
     * Add event listener
     */
    on(eventType, listener) {
        let listeners = this.eventListeners.get(eventType);
        if (!listeners) {
            listeners = new Set();
            this.eventListeners.set(eventType, listeners);
        }
        listeners.add(listener);
    }
    /**
     * Remove event listener
     */
    off(eventType, listener) {
        const listeners = this.eventListeners.get(eventType);
        if (listeners) {
            listeners.delete(listener);
        }
    }
    /**
     * Create a new session
     */
    async create(userId, metadata) {
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + this.config.sessionTtlMs).toISOString();
        const session = {
            id: this.generateId(),
            userId,
            status: "active",
            createdAt: now,
            updatedAt: now,
            lastActivityAt: now,
            expiresAt,
            metadata,
        };
        // Create session context
        const context = {
            ...session,
            messages: [],
            tokenUsage: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                inputCost: 0,
                outputCost: 0,
                totalCost: 0,
                tokenBudget: this.config.maxTokenBudget,
            },
            metrics: {
                totalMessages: 0,
                totalToolCalls: 0,
                totalToolResults: 0,
                totalTurns: 0,
                averageLatencyMs: 0,
                errorCount: 0,
                retryCount: 0,
            },
            policyState: {
                rateLimitRemaining: 60,
                suspended: false,
            },
        };
        // Save to store
        await this.store.save(context);
        // Initialize context window
        this.contextWindows.set(session.id, new ContextWindowManager(this.config.maxTokenBudget));
        this.emit("session:created", session.id, { userId, metadata });
        return session;
    }
    /**
     * Get session
     */
    async get(sessionId) {
        return this.store.getSummary(sessionId);
    }
    /**
     * Get session with full context
     */
    async getContext(sessionId) {
        const context = await this.store.load(sessionId);
        if (context) {
            // Ensure context window exists
            if (!this.contextWindows.has(sessionId)) {
                const window = new ContextWindowManager(this.config.maxTokenBudget);
                window.initialize(context.messages);
                this.contextWindows.set(sessionId, window);
            }
        }
        return context;
    }
    /**
     * End a session (close it)
     */
    async end(sessionId) {
        const context = await this.store.load(sessionId);
        if (!context)
            return;
        context.status = "closed";
        context.updatedAt = new Date().toISOString();
        await this.store.save(context);
        this.contextWindows.delete(sessionId);
        this.policyEngine.resetState(sessionId);
        this.emit("session:closed", sessionId);
    }
    /**
     * Suspend session
     */
    async suspend(sessionId, reason) {
        const context = await this.store.load(sessionId);
        if (!context)
            return;
        context.status = "suspended";
        context.updatedAt = new Date().toISOString();
        this.policyEngine.suspend(sessionId, reason);
        await this.store.save(context);
        this.emit("session:suspended", sessionId, { reason });
    }
    /**
     * Resume session
     */
    async resume(sessionId) {
        const context = await this.store.load(sessionId);
        if (!context)
            return null;
        if (context.status !== "suspended") {
            return null;
        }
        context.status = "active";
        context.updatedAt = new Date().toISOString();
        context.lastActivityAt = new Date().toISOString();
        this.policyEngine.resume(sessionId);
        await this.store.save(context);
        this.emit("session:resumed", sessionId);
        return {
            id: context.id,
            userId: context.userId,
            status: context.status,
            createdAt: context.createdAt,
            updatedAt: context.updatedAt,
            lastActivityAt: context.lastActivityAt,
            expiresAt: context.expiresAt,
            metadata: context.metadata,
        };
    }
    /**
     * Add message to session
     */
    async addMessage(sessionId, message) {
        // Check policy
        if (!this.policyEngine.canProceed(sessionId, "message")) {
            const violation = this.policyEngine.getViolationType(sessionId);
            this.emit("policy:violation", sessionId, { violation });
            return null;
        }
        const context = await this.store.load(sessionId);
        if (!context)
            return null;
        // Get or create context window
        let window = this.contextWindows.get(sessionId);
        if (!window) {
            window = new ContextWindowManager(this.config.maxTokenBudget);
            window.initialize(context.messages);
            this.contextWindows.set(sessionId, window);
        }
        // Add message
        const fullMessage = window.add(message);
        // Update context
        context.messages = window.getAll();
        context.metrics.totalMessages++;
        context.updatedAt = new Date().toISOString();
        context.lastActivityAt = new Date().toISOString();
        // Record action
        this.policyEngine.recordAction(sessionId, "message");
        await this.store.save(context);
        this.emit("message:added", sessionId, {
            messageId: fullMessage.id,
            role: fullMessage.role,
        });
        return fullMessage;
    }
    /**
     * Get messages for a session
     */
    async getMessages(sessionId, options) {
        const context = await this.store.load(sessionId);
        if (!context)
            return [];
        const messages = context.messages;
        if (options?.offset) {
            return messages.slice(options.offset);
        }
        if (options?.limit) {
            return messages.slice(-options.limit);
        }
        return messages;
    }
    /**
     * Get messages fitting token budget
     */
    async getMessagesForContext(sessionId, targetTokens) {
        let window = this.contextWindows.get(sessionId);
        if (!window) {
            const context = await this.store.load(sessionId);
            if (!context)
                return [];
            window = new ContextWindowManager(this.config.maxTokenBudget);
            window.initialize(context.messages);
            this.contextWindows.set(sessionId, window);
        }
        return window.getMessagesForContext(targetTokens);
    }
    /**
     * Update token usage
     */
    async updateTokenUsage(sessionId, usage) {
        const context = await this.store.load(sessionId);
        if (!context)
            return;
        context.tokenUsage = {
            ...context.tokenUsage,
            ...usage,
        };
        // Record in policy engine
        this.policyEngine.recordTokenUsage(sessionId, context.tokenUsage);
        // Check budget
        if (context.tokenUsage.totalCost > this.config.maxTokenBudget / 1000) {
            this.emit("budget:exceeded", sessionId, {
                cost: context.tokenUsage.totalCost,
            });
        }
        await this.store.save(context);
    }
    /**
     * Get metrics for a session
     */
    async getMetrics(sessionId) {
        const context = await this.store.load(sessionId);
        return context?.metrics ?? null;
    }
    /**
     * Get all sessions for a user
     */
    async listByUser(userId) {
        return this.store.listByUser(userId);
    }
    /**
     * Delete session
     */
    async delete(sessionId) {
        await this.store.delete(sessionId);
        this.contextWindows.delete(sessionId);
        this.policyEngine.resetState(sessionId);
    }
    /**
     * Cleanup expired sessions
     */
    async cleanup() {
        const sessions = await this.store.listAll();
        const now = Date.now();
        let cleaned = 0;
        for (const session of sessions) {
            // Check if expired
            if (session.expiresAt) {
                const expiresAt = new Date(session.expiresAt).getTime();
                if (now >= expiresAt) {
                    await this.end(session.id);
                    cleaned++;
                    this.emit("session:expired", session.id);
                }
            }
            // Check if idle too long
            const lastActivity = new Date(session.lastActivityAt).getTime();
            if (now - lastActivity > this.config.maxIdleMs) {
                await this.suspend(session.id, "Idle timeout");
                cleaned++;
            }
        }
        // Cleanup policy engine
        this.policyEngine.cleanup();
        return cleaned;
    }
    /**
     * Close manager
     */
    async close() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        await this.store.close();
    }
}
// ─── Factory Function ────────────────────────────────────────────────────
/**
 * Create a session manager
 */
export function createSessionManager(config) {
    return new SessionManager(config);
}
//# sourceMappingURL=manager.js.map