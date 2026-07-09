/**
 * Session Manager - Policy Engine
 *
 * Session policy enforcement and budget tracking.
 */

import type { PolicyEngineConfig, PolicyState, TokenUsage } from "./types.js";

// ─── Rate Limiter ──────────────────────────────────────────────────────────

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

export class RateLimiter {
	private entries: Map<string, RateLimitEntry> = new Map();
	private readonly requestsPerMinute: number;

	constructor(requestsPerMinute: number) {
		this.requestsPerMinute = requestsPerMinute;
	}

	/**
	 * Check if request is allowed
	 */
	canMakeRequest(key: string): boolean {
		const now = Date.now();
		const entry = this.entries.get(key);

		if (!entry || now >= entry.resetAt) {
			return true;
		}

		return entry.count < this.requestsPerMinute;
	}

	/**
	 * Record a request
	 */
	recordRequest(key: string): void {
		const now = Date.now();
		const entry = this.entries.get(key);

		if (!entry || now >= entry.resetAt) {
			// Start new window
			this.entries.set(key, {
				count: 1,
				resetAt: now + 60000, // 1 minute
			});
		} else {
			entry.count++;
		}
	}

	/**
	 * Get remaining requests
	 */
	getRemaining(key: string): number {
		const entry = this.entries.get(key);
		if (!entry || Date.now() >= entry.resetAt) {
			return this.requestsPerMinute;
		}

		return Math.max(0, this.requestsPerMinute - entry.count);
	}

	/**
	 * Clear expired entries
	 */
	clearExpired(): void {
		const now = Date.now();
		for (const [key, entry] of this.entries) {
			if (now >= entry.resetAt) {
				this.entries.delete(key);
			}
		}
	}
}

// ─── Budget Tracker ────────────────────────────────────────────────────────

interface BudgetEntry {
	spent: number;
	limit: number;
	resetAt: number;
}

export class BudgetTracker {
	private entries: Map<string, BudgetEntry> = new Map();

	/**
	 * Set budget for a key
	 */
	setBudget(key: string, limit: number, resetAtMs: number): void {
		this.entries.set(key, {
			spent: 0,
			limit,
			resetAt: Date.now() + resetAtMs,
		});
	}

	/**
	 * Check if budget allows spending
	 */
	canSpend(key: string, amount: number): boolean {
		const entry = this.entries.get(key);
		if (!entry) return true;

		// Check if reset time passed
		if (Date.now() >= entry.resetAt) {
			return true;
		}

		return entry.spent + amount <= entry.limit;
	}

	/**
	 * Record spending
	 */
	recordSpend(key: string, amount: number): void {
		const entry = this.entries.get(key);
		if (!entry) return;

		// Check if reset time passed
		if (Date.now() >= entry.resetAt) {
			entry.spent = amount;
			entry.resetAt = Date.now() + (entry.resetAt - Date.now());
		} else {
			entry.spent += amount;
		}
	}

	/**
	 * Get remaining budget
	 */
	getRemaining(key: string): number | null {
		const entry = this.entries.get(key);
		if (!entry) return null;

		if (Date.now() >= entry.resetAt) {
			return entry.limit;
		}

		return Math.max(0, entry.limit - entry.spent);
	}

	/**
	 * Get reset time
	 */
	getResetAt(key: string): number | null {
		const entry = this.entries.get(key);
		if (!entry) return null;

		return entry.resetAt;
	}
}

// ─── Policy Engine ─────────────────────────────────────────────────────────

export class PolicyEngine {
	private readonly config: PolicyEngineConfig;
	private readonly rateLimiter: RateLimiter;
	private readonly budgetTracker: BudgetTracker;
	private sessionStates: Map<string, PolicyState> = new Map();

	constructor(config: PolicyEngineConfig = {}) {
		this.config = {
			maxRequestsPerMinute: config.maxRequestsPerMinute ?? 60,
			maxTokensPerDay: config.maxTokensPerDay ?? 1000000,
			maxCostPerSession: config.maxCostPerSession ?? 100,
			maxConcurrentSessions: config.maxConcurrentSessions ?? 10,
			sessionBudget: config.sessionBudget ?? 50,
		};

		this.rateLimiter = new RateLimiter(this.config.maxRequestsPerMinute!);
		this.budgetTracker = new BudgetTracker();
	}

	/**
	 * Get policy state for a session
	 */
	getPolicyState(sessionId: string): PolicyState {
		let state = this.sessionStates.get(sessionId);
		if (!state) {
			state = {
				rateLimitRemaining: this.config.maxRequestsPerMinute ?? 60,
				suspended: false,
			};
			this.sessionStates.set(sessionId, state);
		}
		return state;
	}

	/**
	 * Check if action is allowed
	 */
	canProceed(
		sessionId: string,
		action: "message" | "tool_call" | "session_create",
	): boolean {
		const state = this.getPolicyState(sessionId);

		// Check if suspended
		if (state.suspended) {
			return false;
		}

		// Check rate limit
		if (!this.rateLimiter.canMakeRequest(sessionId)) {
			return false;
		}

		// Check budget
		if (state.budgetRemaining !== undefined && state.budgetRemaining <= 0) {
			return false;
		}

		return true;
	}

	/**
	 * Record an action
	 */
	recordAction(sessionId: string, action: "message" | "tool_call"): void {
		// Record rate limit
		this.rateLimiter.recordRequest(sessionId);

		// Update state
		const state = this.getPolicyState(sessionId);
		state.rateLimitRemaining = this.rateLimiter.getRemaining(sessionId);

		// Update rate limit reset time
		const resetAt = Date.now() + 60000;
		state.rateLimitResetAt = new Date(resetAt).toISOString();
	}

	/**
	 * Record token usage
	 */
	recordTokenUsage(sessionId: string, usage: TokenUsage): void {
		const state = this.getPolicyState(sessionId);

		if (this.config.sessionBudget) {
			// Convert cost to cents for tracking
			const costInCents = Math.round(usage.totalCost * 100);
			this.budgetTracker.recordSpend(sessionId, costInCents);

			state.budgetRemaining = this.budgetTracker.getRemaining(sessionId)
				? this.budgetTracker.getRemaining(sessionId)! / 100
				: undefined;

			const resetAt = this.budgetTracker.getResetAt(sessionId);
			if (resetAt) {
				state.budgetResetAt = new Date(resetAt).toISOString();
			}
		}
	}

	/**
	 * Suspend a session
	 */
	suspend(sessionId: string, reason: string): void {
		const state = this.getPolicyState(sessionId);
		state.suspended = true;
		state.suspensionReason = reason;
	}

	/**
	 * Resume a session
	 */
	resume(sessionId: string): void {
		const state = this.getPolicyState(sessionId);
		state.suspended = false;
		state.suspensionReason = undefined;
	}

	/**
	 * Reset session policy state
	 */
	resetState(sessionId: string): void {
		this.sessionStates.delete(sessionId);
	}

	/**
	 * Set session budget
	 */
	setSessionBudget(sessionId: string, budget: number, periodMs: number): void {
		const budgetInCents = Math.round(budget * 100);
		this.budgetTracker.setBudget(sessionId, budgetInCents, periodMs);

		const state = this.getPolicyState(sessionId);
		state.budgetRemaining = budget;
		state.budgetResetAt = new Date(Date.now() + periodMs).toISOString();
	}

	/**
	 * Get violation type
	 */
	getViolationType(sessionId: string): string | null {
		const state = this.getPolicyState(sessionId);

		if (state.suspended) {
			return `suspended: ${state.suspensionReason}`;
		}

		if (state.rateLimitRemaining <= 0) {
			return "rate_limit_exceeded";
		}

		if (state.budgetRemaining !== undefined && state.budgetRemaining <= 0) {
			return "budget_exceeded";
		}

		return null;
	}

	/**
	 * Check if session exceeds cost limit
	 */
	exceedsCostLimit(sessionId: string, additionalCost: number): boolean {
		const state = this.getPolicyState(sessionId);

		if (this.config.maxCostPerSession && state.budgetRemaining !== undefined) {
			return state.budgetRemaining - additionalCost < 0;
		}

		return false;
	}

	/**
	 * Get rate limit info
	 */
	getRateLimitInfo(
		sessionId: string,
	): { remaining: number; resetAt: string } | null {
		const remaining = this.rateLimiter.getRemaining(sessionId);
		if (remaining === this.config.maxRequestsPerMinute) {
			return null;
		}

		return {
			remaining,
			resetAt: new Date(Date.now() + 60000).toISOString(),
		};
	}

	/**
	 * Clean up expired state
	 */
	cleanup(): void {
		this.rateLimiter.clearExpired();
	}
}

// ─── Factory Function ────────────────────────────────────────────────────

/**
 * Create a policy engine
 */
export function createPolicyEngine(config?: PolicyEngineConfig): PolicyEngine {
	return new PolicyEngine(config);
}
