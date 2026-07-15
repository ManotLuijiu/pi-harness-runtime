/**
 * Rate Limiter — Core (RFC-0023)
 */
export class RateLimiter {
    config;
    buckets = new Map();
    stats = new Map();
    constructor(config) {
        this.config = {
            algorithm: config.algorithm ?? "token-bucket",
            capacity: config.capacity ?? 100,
            refillRate: config.refillRate ?? 10,
            refillIntervalMs: config.refillIntervalMs ?? 1000,
            scope: config.scope ?? "global",
        };
        this.buckets.set("__global__", { tokens: this.config.capacity, lastRefill: Date.now() });
        this.stats.set("__global__", { key: "__global__", totalRequests: 0, allowedRequests: 0, rejectedRequests: 0, hitRate: 0 });
    }
    consume(key, tokens = 1) {
        const effectiveKey = this.resolveKey(key);
        const now = Date.now();
        this.refill(effectiveKey, now);
        const state = this.buckets.get(effectiveKey);
        if (state.tokens >= tokens) {
            state.tokens -= tokens;
            this.recordRequest(effectiveKey, true);
            return {
                allowed: true,
                remaining: Math.floor(state.tokens),
                resetAt: now + this.config.refillIntervalMs,
            };
        }
        const retryAfterMs = Math.ceil((tokens - state.tokens) / this.config.refillRate * this.config.refillIntervalMs);
        this.recordRequest(effectiveKey, false);
        return {
            allowed: false,
            remaining: Math.floor(state.tokens),
            resetAt: now + retryAfterMs,
            retryAfterMs,
        };
    }
    reset(key) {
        const effectiveKey = this.resolveKey(key);
        this.buckets.set(effectiveKey, { tokens: this.config.capacity, lastRefill: Date.now() });
    }
    peek(key) {
        const effectiveKey = this.resolveKey(key);
        const now = Date.now();
        this.refill(effectiveKey, now);
        return { ...(this.buckets.get(effectiveKey) ?? { tokens: this.config.capacity, lastRefill: now }) };
    }
    getStats(key) {
        const effectiveKey = this.resolveKey(key);
        return this.stats.get(effectiveKey) ?? {
            key: effectiveKey,
            totalRequests: 0,
            allowedRequests: 0,
            rejectedRequests: 0,
            hitRate: 0,
        };
    }
    listKeys() {
        return [...this.buckets.keys()].filter((k) => k !== "__global__");
    }
    size() {
        return this.buckets.size;
    }
    resolveKey(key) {
        if (this.config.scope === "global")
            return "__global__";
        return key ?? "__default__";
    }
    refill(key, now) {
        let state = this.buckets.get(key);
        if (!state) {
            state = { tokens: this.config.capacity, lastRefill: now };
            this.buckets.set(key, state);
            this.stats.set(key, { key, totalRequests: 0, allowedRequests: 0, rejectedRequests: 0, hitRate: 0 });
        }
        if (now - state.lastRefill < this.config.refillIntervalMs)
            return;
        const intervals = Math.floor((now - state.lastRefill) / this.config.refillIntervalMs);
        const toAdd = intervals * this.config.refillRate;
        state.tokens = Math.min(this.config.capacity, state.tokens + toAdd);
        state.lastRefill = state.lastRefill + intervals * this.config.refillIntervalMs;
    }
    recordRequest(key, allowed) {
        let s = this.stats.get(key);
        if (!s) {
            s = { key, totalRequests: 0, allowedRequests: 0, rejectedRequests: 0, hitRate: 0 };
            this.stats.set(key, s);
        }
        s.totalRequests++;
        if (allowed)
            s.allowedRequests++;
        else
            s.rejectedRequests++;
        s.hitRate = s.totalRequests > 0 ? s.allowedRequests / s.totalRequests : 0;
    }
}
//# sourceMappingURL=limiter.js.map