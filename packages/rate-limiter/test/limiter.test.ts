/**
 * Rate Limiter Tests (RFC-0023)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { RateLimiter } from "../src/index.js";

describe("RateLimiter", () => {
  it("allows requests within capacity", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 10, refillRate: 5, refillIntervalMs: 1000 });
    const result = limiter.consume();
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeLessThanOrEqual(10);
  });

  it("rejects when tokens exhausted", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 2, refillRate: 1, refillIntervalMs: 1000 });
    limiter.consume();
    limiter.consume();
    const result = limiter.consume();
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills tokens over time", async () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 5, refillRate: 10, refillIntervalMs: 10 });
    limiter.consume();
    limiter.consume();
    await new Promise((r) => setTimeout(r, 30));
    const result = limiter.consume();
    expect(result.allowed).toBe(true);
  });

  it("consumes multiple tokens at once", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 5, refillRate: 1, refillIntervalMs: 1000 });
    const result = limiter.consume(undefined, 5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeLessThanOrEqual(0);
  });

  it("per-client scope has separate buckets", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 3, refillRate: 1, refillIntervalMs: 1000, scope: "per-client" });
    limiter.consume("client1");
    limiter.consume("client1");
    limiter.consume("client2");
    const c1 = limiter.peek("client1");
    const c2 = limiter.peek("client2");
    expect(c1.tokens).not.toBe(c2.tokens);
  });

  it("global scope shares single bucket", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 3, refillRate: 1, refillIntervalMs: 1000, scope: "global" });
    limiter.consume("client1");
    limiter.consume("client2");
    expect(limiter.size()).toBe(1); // only global bucket
  });

  it("reset restores full capacity", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 5, refillRate: 1, refillIntervalMs: 1000 });
    limiter.consume();
    limiter.consume();
    limiter.reset();
    const result = limiter.consume();
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeLessThanOrEqual(5);
  });

  it("peek shows current tokens without consuming", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 5, refillRate: 1, refillIntervalMs: 1000 });
    limiter.consume();
    const state = limiter.peek();
    expect(state.tokens).toBeLessThan(5);
    // Second peek shouldn't consume
    const state2 = limiter.peek();
    expect(state.tokens).toBe(state2.tokens);
  });

  it("getStats tracks requests", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 10, refillRate: 5, refillIntervalMs: 1000 });
    limiter.consume();
    limiter.consume();
    limiter.consume();
    const stats = limiter.getStats();
    expect(stats.totalRequests).toBe(3);
    expect(stats.allowedRequests).toBe(3);
  });

  it("getStats records rejections", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 1, refillRate: 1, refillIntervalMs: 1000 });
    limiter.consume();
    limiter.consume();
    limiter.consume();
    const stats = limiter.getStats();
    expect(stats.rejectedRequests).toBeGreaterThan(0);
  });

  it("listKeys returns client keys", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 10, refillRate: 5, refillIntervalMs: 1000, scope: "per-client" });
    limiter.consume("alice");
    limiter.consume("bob");
    const keys = limiter.listKeys();
    expect(keys).toContain("alice");
    expect(keys).toContain("bob");
  });

  it("reset with key resets only that key", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 3, refillRate: 1, refillIntervalMs: 1000, scope: "per-client" });
    limiter.consume("alice");
    limiter.consume("bob");
    limiter.reset("alice");
    expect(limiter.peek("alice").tokens).toBe(3);
    expect(limiter.peek("bob").tokens).toBeLessThan(3);
  });

  it("size returns bucket count", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 10, refillRate: 5, refillIntervalMs: 1000, scope: "per-client" });
    expect(limiter.size()).toBeGreaterThanOrEqual(1);
    limiter.consume("a");
    limiter.consume("b");
    expect(limiter.size()).toBeGreaterThanOrEqual(2);
  });

  it("returns resetAt timestamp", () => {
    const limiter = new RateLimiter({ algorithm: "token-bucket", capacity: 5, refillRate: 2, refillIntervalMs: 1000 });
    const result = limiter.consume();
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});
