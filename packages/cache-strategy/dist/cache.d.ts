/**
 * Cache Strategy — Core (RFC-0022)
 */
import type { CacheConfig, CacheStats, InvalidationResult, TagGroup } from "./types.js";
export declare class CacheStrategy<T = unknown> {
    private entries;
    private config;
    private hitCount;
    private missCount;
    private evictCount;
    private tagIndex;
    constructor(config: CacheConfig);
    set(key: string, value: T, ttlMs?: number, tags?: string[]): void;
    get(key: string): T | undefined;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    invalidateByTag(tag: string): InvalidationResult;
    invalidateByPattern(pattern: RegExp): InvalidationResult;
    stats(): CacheStats;
    resetStats(): void;
    getTagGroups(): TagGroup[];
    size(): number;
    keys(): string[];
    private isExpired;
    private enforceMaxSize;
    private evictLRU;
    private evictLFU;
    private evictTTL;
}
//# sourceMappingURL=cache.d.ts.map