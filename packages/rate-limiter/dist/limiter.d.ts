/**
 * Rate Limiter — Core (RFC-0023)
 */
import type { BucketState, RateLimitConfig, RateLimitResult, RateLimitStats } from "./types.js";
export declare class RateLimiter {
    private config;
    private buckets;
    private stats;
    constructor(config: RateLimitConfig);
    consume(key?: string, tokens?: number): RateLimitResult;
    reset(key?: string): void;
    peek(key?: string): BucketState;
    getStats(key?: string): RateLimitStats;
    listKeys(): string[];
    size(): number;
    private resolveKey;
    private refill;
    private recordRequest;
}
//# sourceMappingURL=limiter.d.ts.map