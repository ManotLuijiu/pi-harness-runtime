/**
 * Rate Limiter — Types (RFC-0023)
 */

export type RateLimitScope = "global" | "per-client" | "per-key";
export type RateLimitAlgorithm = "token-bucket" | "leaky-bucket" | "sliding-window";

export interface RateLimitConfig {
	algorithm: RateLimitAlgorithm;
	capacity: number;
	refillRate: number;
	refillIntervalMs: number;
	scope?: RateLimitScope;
}

export interface RateLimitRecord {
	key: string;
	tokens: number;
	lastRefill: number;
	consumed: number;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetAt: number;
	retryAfterMs?: number;
}

export interface RateLimitStats {
	key: string;
	totalRequests: number;
	allowedRequests: number;
	rejectedRequests: number;
	hitRate: number;
}

export interface BucketState {
	tokens: number;
	lastRefill: number;
}
