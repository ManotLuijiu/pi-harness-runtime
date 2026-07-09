/**
 * Session Manager - Policy Engine
 *
 * Session policy enforcement and budget tracking.
 */
import type { PolicyEngineConfig, PolicyState, TokenUsage } from "./types.js";
export declare class RateLimiter {
    private entries;
    private readonly requestsPerMinute;
    constructor(requestsPerMinute: number);
    /**
     * Check if request is allowed
     */
    canMakeRequest(key: string): boolean;
    /**
     * Record a request
     */
    recordRequest(key: string): void;
    /**
     * Get remaining requests
     */
    getRemaining(key: string): number;
    /**
     * Clear expired entries
     */
    clearExpired(): void;
}
export declare class BudgetTracker {
    private entries;
    /**
     * Set budget for a key
     */
    setBudget(key: string, limit: number, resetAtMs: number): void;
    /**
     * Check if budget allows spending
     */
    canSpend(key: string, amount: number): boolean;
    /**
     * Record spending
     */
    recordSpend(key: string, amount: number): void;
    /**
     * Get remaining budget
     */
    getRemaining(key: string): number | null;
    /**
     * Get reset time
     */
    getResetAt(key: string): number | null;
}
export declare class PolicyEngine {
    private readonly config;
    private readonly rateLimiter;
    private readonly budgetTracker;
    private sessionStates;
    constructor(config?: PolicyEngineConfig);
    /**
     * Get policy state for a session
     */
    getPolicyState(sessionId: string): PolicyState;
    /**
     * Check if action is allowed
     */
    canProceed(sessionId: string, action: "message" | "tool_call" | "session_create"): boolean;
    /**
     * Record an action
     */
    recordAction(sessionId: string, action: "message" | "tool_call"): void;
    /**
     * Record token usage
     */
    recordTokenUsage(sessionId: string, usage: TokenUsage): void;
    /**
     * Suspend a session
     */
    suspend(sessionId: string, reason: string): void;
    /**
     * Resume a session
     */
    resume(sessionId: string): void;
    /**
     * Reset session policy state
     */
    resetState(sessionId: string): void;
    /**
     * Set session budget
     */
    setSessionBudget(sessionId: string, budget: number, periodMs: number): void;
    /**
     * Get violation type
     */
    getViolationType(sessionId: string): string | null;
    /**
     * Check if session exceeds cost limit
     */
    exceedsCostLimit(sessionId: string, additionalCost: number): boolean;
    /**
     * Get rate limit info
     */
    getRateLimitInfo(sessionId: string): {
        remaining: number;
        resetAt: string;
    } | null;
    /**
     * Clean up expired state
     */
    cleanup(): void;
}
/**
 * Create a policy engine
 */
export declare function createPolicyEngine(config?: PolicyEngineConfig): PolicyEngine;
//# sourceMappingURL=policy.d.ts.map