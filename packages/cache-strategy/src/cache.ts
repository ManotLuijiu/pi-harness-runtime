/**
 * Cache Strategy — Core (RFC-0022)
 */

import type {
	CacheConfig,
	CacheEntry,
	CacheStats,
	InvalidationResult,
	InvalidationStrategy,
	TagGroup,
} from "./types.js";

export class CacheStrategy<T = unknown> {
	private entries = new Map<string, CacheEntry<T>>();
	private config: Required<CacheConfig>;
	private hitCount = 0;
	private missCount = 0;
	private evictCount = 0;
	private tagIndex = new Map<string, Set<string>>();

	constructor(config: CacheConfig) {
		this.config = {
			strategy: config.strategy ?? "lru",
			defaultTtlMs: config.defaultTtlMs ?? 300_000,
			maxSize: config.maxSize ?? 1000,
			onEvict: config.onEvict ?? (() => {}),
		};
	}

	set(key: string, value: T, ttlMs?: number, tags?: string[]): void {
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
				if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
				this.tagIndex.get(tag)!.add(key);
			}
		}
		this.enforceMaxSize();
	}

	get(key: string): T | undefined {
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

	has(key: string): boolean {
		const entry = this.entries.get(key);
		if (!entry) return false;
		if (this.isExpired(entry)) {
			this.delete(key);
			return false;
		}
		return true;
	}

	delete(key: string): boolean {
		const entry = this.entries.get(key);
		if (!entry) return false;
		if (entry.tags) {
			for (const tag of entry.tags) {
				this.tagIndex.get(tag)?.delete(key);
			}
		}
		this.config.onEvict(key, entry);
		this.evictCount++;
		return this.entries.delete(key);
	}

	clear(): void {
		this.entries.clear();
		this.tagIndex.clear();
	}

	invalidateByTag(tag: string): InvalidationResult {
		const keys = this.tagIndex.get(tag);
		if (!keys) return { invalidated: 0, remaining: this.entries.size };
		const count = keys.size;
		for (const k of keys) {
			this.delete(k);
		}
		this.tagIndex.delete(tag);
		return { invalidated: count, remaining: this.entries.size };
	}

	invalidateByPattern(pattern: RegExp): InvalidationResult {
		let count = 0;
		for (const key of this.entries.keys()) {
			if (pattern.test(key)) {
				this.delete(key);
				count++;
			}
		}
		return { invalidated: count, remaining: this.entries.size };
	}

	stats(): CacheStats {
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

	resetStats(): void {
		this.hitCount = 0;
		this.missCount = 0;
		this.evictCount = 0;
	}

	getTagGroups(): TagGroup[] {
		const groups: TagGroup[] = [];
		for (const [tag, keys] of this.tagIndex) {
			groups.push({ tag, keys: [...keys] });
		}
		return groups;
	}

	size(): number {
		return this.entries.size;
	}

	keys(): string[] {
		return [...this.entries.keys()];
	}

	private isExpired(entry: CacheEntry<T>): boolean {
		if (!entry.ttl) return false;
		return Date.now() - entry.createdAt > entry.ttl;
	}

	private enforceMaxSize(): void {
		if (this.entries.size <= (this.config.maxSize ?? Infinity)) return;

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
				if (first) this.delete(first);
			}
		}
	}

	private evictLRU(): void {
		let oldest: string | undefined;
		let oldestTime = Infinity;
		for (const [key, entry] of this.entries) {
			if (entry.accessedAt < oldestTime) {
				oldestTime = entry.accessedAt;
				oldest = key;
			}
		}
		if (oldest) this.delete(oldest);
	}

	private evictLFU(): void {
		let lowest: string | undefined;
		let lowestHits = Infinity;
		for (const [key, entry] of this.entries) {
			if (entry.hits < lowestHits) {
				lowestHits = entry.hits;
				lowest = key;
			}
		}
		if (lowest) this.delete(lowest);
	}

	private evictTTL(): void {
		let oldest: string | undefined;
		let oldestTime = Infinity;
		for (const [key, entry] of this.entries) {
			const age = Date.now() - entry.createdAt;
			if (age > oldestTime) {
				oldestTime = age;
				oldest = key;
			}
		}
		if (oldest) this.delete(oldest);
	}
}
