/**
 * Cache Strategy — Types (RFC-0022)
 */
export type InvalidationStrategy = "ttl" | "lru" | "lfu" | "manual" | "tag-based";
export interface CacheEntry<T = unknown> {
    key: string;
    value: T;
    createdAt: number;
    accessedAt: number;
    hits: number;
    ttl?: number;
    tags?: string[];
}
export interface CacheConfig {
    strategy: InvalidationStrategy;
    defaultTtlMs?: number;
    maxSize?: number;
    onEvict?: (key: string, entry: CacheEntry) => void;
}
export interface CacheStats {
    hits: number;
    misses: number;
    evictions: number;
    size: number;
    hitRate: number;
}
export interface InvalidationResult {
    invalidated: number;
    remaining: number;
}
export interface TagGroup {
    tag: string;
    keys: string[];
}
//# sourceMappingURL=types.d.ts.map