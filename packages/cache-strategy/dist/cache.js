/**
 * Cache Strategy — Core (RFC-0022)
 */
export class CacheStrategy {
    entries = new Map();
    config;
    hitCount = 0;
    missCount = 0;
    evictCount = 0;
    tagIndex = new Map();
    constructor(config) {
        this.config = {
            strategy: config.strategy ?? "lru",
            defaultTtlMs: config.defaultTtlMs ?? 300_000,
            maxSize: config.maxSize ?? 1000,
            onEvict: config.onEvict ?? (() => { }),
        };
    }
    set(key, value, ttlMs, tags) {
        const now = Date.now();
        this.entries.set(key, {
            key,
            value,
            createdAt: now,
            accessedAt: now,
            hits: 0,
            ttl: ttlMs ?? this.config.defaultTtlMs,
            tags,
        });
        if (tags) {
            for (const tag of tags) {
                if (!this.tagIndex.has(tag))
                    this.tagIndex.set(tag, new Set());
                this.tagIndex.get(tag).add(key);
            }
        }
        this.enforceMaxSize();
    }
    get(key) {
        const entry = this.entries.get(key);
        if (!entry) {
            this.missCount++;
            return undefined;
        }
        if (this.isExpired(entry)) {
            this.delete(key);
            this.missCount++;
            return undefined;
        }
        entry.accessedAt = Date.now();
        entry.hits++;
        this.hitCount++;
        return entry.value;
    }
    has(key) {
        const entry = this.entries.get(key);
        if (!entry)
            return false;
        if (this.isExpired(entry)) {
            this.delete(key);
            return false;
        }
        return true;
    }
    delete(key) {
        const entry = this.entries.get(key);
        if (!entry)
            return false;
        if (entry.tags) {
            for (const tag of entry.tags) {
                this.tagIndex.get(tag)?.delete(key);
            }
        }
        this.config.onEvict(key, entry);
        this.evictCount++;
        return this.entries.delete(key);
    }
    clear() {
        this.entries.clear();
        this.tagIndex.clear();
    }
    invalidateByTag(tag) {
        const keys = this.tagIndex.get(tag);
        if (!keys)
            return { invalidated: 0, remaining: this.entries.size };
        const count = keys.size;
        for (const k of keys) {
            this.delete(k);
        }
        this.tagIndex.delete(tag);
        return { invalidated: count, remaining: this.entries.size };
    }
    invalidateByPattern(pattern) {
        let count = 0;
        for (const key of this.entries.keys()) {
            if (pattern.test(key)) {
                this.delete(key);
                count++;
            }
        }
        return { invalidated: count, remaining: this.entries.size };
    }
    stats() {
        return {
            hits: this.hitCount,
            misses: this.missCount,
            evictions: this.evictCount,
            size: this.entries.size,
            hitRate: this.hitCount + this.missCount > 0
                ? this.hitCount / (this.hitCount + this.missCount)
                : 0,
        };
    }
    resetStats() {
        this.hitCount = 0;
        this.missCount = 0;
        this.evictCount = 0;
    }
    getTagGroups() {
        const groups = [];
        for (const [tag, keys] of this.tagIndex) {
            groups.push({ tag, keys: [...keys] });
        }
        return groups;
    }
    size() {
        return this.entries.size;
    }
    keys() {
        return [...this.entries.keys()];
    }
    isExpired(entry) {
        if (!entry.ttl)
            return false;
        return Date.now() - entry.createdAt > entry.ttl;
    }
    enforceMaxSize() {
        if (this.entries.size <= (this.config.maxSize ?? Infinity))
            return;
        switch (this.config.strategy) {
            case "lru":
                this.evictLRU();
                break;
            case "lfu":
                this.evictLFU();
                break;
            case "ttl":
                this.evictTTL();
                break;
            default: {
                const first = this.entries.keys().next().value;
                if (first)
                    this.delete(first);
            }
        }
    }
    evictLRU() {
        let oldest;
        let oldestTime = Infinity;
        for (const [key, entry] of this.entries) {
            if (entry.accessedAt < oldestTime) {
                oldestTime = entry.accessedAt;
                oldest = key;
            }
        }
        if (oldest)
            this.delete(oldest);
    }
    evictLFU() {
        let lowest;
        let lowestHits = Infinity;
        for (const [key, entry] of this.entries) {
            if (entry.hits < lowestHits) {
                lowestHits = entry.hits;
                lowest = key;
            }
        }
        if (lowest)
            this.delete(lowest);
    }
    evictTTL() {
        let oldest;
        let oldestTime = Infinity;
        for (const [key, entry] of this.entries) {
            const age = Date.now() - entry.createdAt;
            if (age > oldestTime) {
                oldestTime = age;
                oldest = key;
            }
        }
        if (oldest)
            this.delete(oldest);
    }
}
//# sourceMappingURL=cache.js.map