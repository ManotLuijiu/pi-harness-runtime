/**
 * Session Manager - Types
 *
 * Core types for session management.
 */
/**
 * SDK version for compatibility checks
 */
export declare const SDK_VERSION = "1.0.0";
/**
 * Session status
 */
export type SessionStatus = "active" | "idle" | "suspended" | "closed" | "expired";
/**
 * Session
 */
export interface Session {
    id: string;
    userId: string;
    status: SessionStatus;
    createdAt: string;
    updatedAt: string;
    lastActivityAt: string;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Session with full context
 */
export interface SessionContext extends Session {
    messages: Message[];
    tokenUsage: TokenUsage;
    metrics: SessionMetrics;
    policyState: PolicyState;
}
/**
 * Message in a session
 */
export interface Message {
    id: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp: string;
    tokens?: number;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    metadata?: Record<string, unknown>;
}
/**
 * Tool call
 */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
/**
 * Tool result
 */
export interface ToolResult {
    toolCallId: string;
    result: unknown;
    error?: string;
    timestamp: string;
}
/**
 * Token usage tracking
 */
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
    tokenBudget?: number;
    resetAt?: string;
}
/**
 * Session metrics
 */
export interface SessionMetrics {
    totalMessages: number;
    totalToolCalls: number;
    totalToolResults: number;
    totalTurns: number;
    averageLatencyMs: number;
    lastProvider?: string;
    errorCount: number;
    retryCount: number;
}
/**
 * Policy state
 */
export interface PolicyState {
    rateLimitRemaining: number;
    rateLimitResetAt?: string;
    budgetRemaining?: number;
    budgetResetAt?: string;
    suspended: boolean;
    suspensionReason?: string;
}
/**
 * Session manager configuration
 */
export interface SessionManagerConfig {
    /**
     * Root directory for session storage
     */
    rootDir?: string;
    /**
     * Session TTL in milliseconds
     */
    sessionTtlMs?: number;
    /**
     * Max idle time before session expires
     */
    maxIdleMs?: number;
    /**
     * Auto-save interval in milliseconds
     */
    autoSaveIntervalMs?: number;
    /**
     * Max messages per session
     */
    maxMessagesPerSession?: number;
    /**
     * Max token budget per session
     */
    maxTokenBudget?: number;
    /**
     * Enable session metrics
     */
    enableMetrics?: boolean;
    /**
     * Enable auto-cleanup
     */
    autoCleanup?: boolean;
    /**
     * Cleanup interval in milliseconds
     */
    cleanupIntervalMs?: number;
}
/**
 * Session store configuration
 */
export interface SessionStoreConfig {
    rootDir: string;
    autoSave: boolean;
    autoSaveIntervalMs: number;
    maxSessions?: number;
}
/**
 * Policy engine configuration
 */
export interface PolicyEngineConfig {
    /**
     * Maximum requests per minute
     */
    maxRequestsPerMinute?: number;
    /**
     * Maximum tokens per day
     */
    maxTokensPerDay?: number;
    /**
     * Maximum cost per session
     */
    maxCostPerSession?: number;
    /**
     * Maximum concurrent sessions
     */
    maxConcurrentSessions?: number;
    /**
     * Session budget
     */
    sessionBudget?: number;
}
/**
 * Session event type
 */
export type SessionEventType = "session:created" | "session:updated" | "session:closed" | "session:expired" | "session:suspended" | "session:resumed" | "message:added" | "policy:violation" | "budget:exceeded";
/**
 * Session event
 */
export interface SessionEvent {
    type: SessionEventType;
    sessionId: string;
    timestamp: string;
    data?: Record<string, unknown>;
}
/**
 * Search filter for messages
 */
export interface MessageSearchFilter {
    sessionId?: string;
    role?: Message["role"];
    startDate?: string;
    endDate?: string;
    contains?: string;
    limit?: number;
    offset?: number;
}
/**
 * Search result
 */
export interface MessageSearchResult {
    sessionId: string;
    messageId: string;
    content: string;
    timestamp: string;
    score: number;
}
//# sourceMappingURL=types.d.ts.map