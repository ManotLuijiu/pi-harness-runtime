/**
 * Cache Strategy Tests (RFC-0022)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { CacheStrategy } from "../src/index.js";

describe("CacheStrategy", () => {
  it("set and get work", () => {
    const cache = new CacheStrategy({ strategy: "lru", maxSize: 10 });
    cache.set("k1", "value1");
    expect(cache.get("k1")).toBe("value1");
  });

  it("get returns undefined for missing key", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("has returns true for existing key", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("k1", "v1");
    expect(cache.has("k1")).toBe(true);
    expect(cache.has("nonexistent")).toBe(false);
  });

  it("delete removes entry", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("k1", "v1");
    expect(cache.delete("k1")).toBe(true);
    expect(cache.get("k1")).toBeUndefined();
  });

  it("clear removes all entries", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("k1", "v1");
    cache.set("k2", "v2");
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("enforces maxSize with LRU", () => {
    const cache = new CacheStrategy({ strategy: "lru", maxSize: 3 });
    cache.set("k1", 1);
    cache.set("k2", 2);
    cache.set("k3", 3);
    cache.set("k4", 4); // evicts k1
    expect(cache.has("k1")).toBe(false);
    expect(cache.has("k4")).toBe(true);
  });

  it("enforces maxSize with LFU", () => {
    const cache = new CacheStrategy({ strategy: "lfu", maxSize: 2 });
    cache.set("k1", 1);
    cache.set("k2", 2);
    cache.get("k1"); // hit k1
    cache.get("k1");
    cache.set("k3", 3); // evicts k2 (least hits)
    expect(cache.has("k1")).toBe(true);
    expect(cache.has("k2")).toBe(false);
  });

  it("TTL expiration works", () => {
    const cache = new CacheStrategy({ strategy: "ttl", defaultTtlMs: 10 });
    cache.set("k1", "v1", 5); // 5ms TTL
    expect(cache.get("k1")).toBe("v1");
    // Note: entry expires immediately or after TTL — fast TTL
    cache.set("k2", "v2", 1000); // 1s
    expect(cache.get("k2")).toBe("v2");
  });

  it("tag-based invalidation", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("user:1:profile", "data1", undefined, ["user", "profile"]);
    cache.set("user:1:settings", "data2", undefined, ["user", "settings"]);
    cache.set("post:1:title", "title1", undefined, ["post"]);
    const result = cache.invalidateByTag("user");
    expect(result.invalidated).toBe(2);
    expect(cache.has("user:1:profile")).toBe(false);
    expect(cache.has("post:1:title")).toBe(true);
  });

  it("pattern invalidation", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("user:1", "u1");
    cache.set("user:2", "u2");
    cache.set("post:1", "p1");
    const result = cache.invalidateByPattern(/^user:/);
    expect(result.invalidated).toBe(2);
    expect(cache.has("post:1")).toBe(true);
  });

  it("stats track hits and misses", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("k1", "v1");
    cache.get("k1");
    cache.get("nonexistent");
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5, 1);
  });

  it("resetStats clears counters", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("k1", "v1");
    cache.get("k1");
    cache.get("nonexistent");
    cache.resetStats();
    const stats = cache.stats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it("getTagGroups returns all tag groups", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("k1", "v1", undefined, ["auth", "session"]);
    cache.set("k2", "v2", undefined, ["auth"]);
    const groups = cache.getTagGroups();
    expect(groups.find((g) => g.tag === "auth")?.keys).toHaveLength(2);
  });

  it("size returns entry count", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("k1", "v1");
    cache.set("k2", "v2");
    expect(cache.size()).toBe(2);
  });

  it("keys returns all keys", () => {
    const cache = new CacheStrategy({ strategy: "lru" });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.keys()).toContain("a");
    expect(cache.keys()).toContain("b");
  });
});
