/**
 * Quota Manager — RFC-0003
 *
 * Collects quota signals from API responses, provider status,
 * Playwright, and local estimates. Produces provider availability state.
 */
export class QuotaManager {
    signals = new Map();
    staleThresholdMs;
    constructor(staleThresholdMs = 30 * 60 * 1000) {
        this.staleThresholdMs = staleThresholdMs;
    }
    /**
     * Record a quota signal
     */
    recordSignal(input) {
        const signal = {
            provider: input.provider,
            windowType: input.windowType,
            usedPct: input.usedPct ?? 0,
            remainingPct: 100 - (input.usedPct ?? 0),
            exhausted: input.exhausted ?? false,
            source: input.source,
            capturedAt: new Date().toISOString(),
            resetsAt: input.resetsAt,
        };
        const key = `${input.provider}:${input.windowType}`;
        const existing = this.signals.get(key) ?? [];
        this.signals.set(key, [...existing, signal]);
    }
    /**
     * Get the latest signal for a provider
     */
    getLatestSignal(provider, windowType) {
        const key = windowType ? `${provider}:${windowType}` : provider;
        if (windowType) {
            const signals = this.signals.get(key) ?? [];
            return (signals.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] ?? null);
        }
        // Return most recent across all window types
        let latest = null;
        let latestTs = 0;
        for (const entry of Array.from(this.signals.entries())) {
            const [k, sigs] = entry;
            if (k.startsWith(`${provider}:`)) {
                const mostRecent = sigs.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
                if (mostRecent) {
                    const ts = Date.parse(mostRecent.capturedAt);
                    if (ts > latestTs) {
                        latestTs = ts;
                        latest = mostRecent;
                    }
                }
            }
        }
        return latest;
    }
    /**
     * Get quota state for a provider
     */
    getProviderState(provider) {
        const signals = this.getSignals(provider);
        const exhausted = signals.some((s) => s.exhausted || (s.usedPct !== undefined && s.usedPct >= 100));
        const limited = signals.some((s) => s.usedPct !== undefined && s.usedPct >= 90);
        // Find next reset time
        let nextAvailableAt;
        for (const signal of signals) {
            if (signal.resetsAt) {
                if (!nextAvailableAt ||
                    Date.parse(signal.resetsAt) < Date.parse(nextAvailableAt)) {
                    nextAvailableAt = signal.resetsAt;
                }
            }
        }
        return {
            provider,
            available: !exhausted && !limited,
            limited,
            exhausted,
            signals,
            nextAvailableAt,
        };
    }
    /**
     * Get signals for a provider
     */
    getSignals(provider) {
        const result = [];
        const cutoff = Date.now() - this.staleThresholdMs;
        for (const entry of Array.from(this.signals.entries())) {
            const [key, sigs] = entry;
            if (key.startsWith(`${provider}:`)) {
                for (const signal of sigs) {
                    if (Date.parse(signal.capturedAt) >= cutoff) {
                        result.push(signal);
                    }
                }
            }
        }
        return result;
    }
    /**
     * Check if provider is available
     */
    isAvailable(provider) {
        return this.getProviderState(provider).available;
    }
    /**
     * Check if provider is exhausted
     */
    isExhausted(provider) {
        return this.getProviderState(provider).exhausted;
    }
    /**
     * Get time until provider is available again
     */
    getWaitTime(provider) {
        const state = this.getProviderState(provider);
        if (!state.nextAvailableAt)
            return null;
        const waitMs = Date.parse(state.nextAvailableAt) - Date.now();
        return waitMs > 0 ? waitMs : null;
    }
    /**
     * Get best available provider from a list
     */
    selectBestProvider(providers) {
        const available = providers.filter((p) => this.isAvailable(p));
        if (available.length === 0)
            return null;
        // Sort by remaining quota (prefer those with more remaining)
        available.sort((a, b) => {
            const signalA = this.getLatestSignal(a);
            const signalB = this.getLatestSignal(b);
            const remA = signalA?.remainingPct ?? 100;
            const remB = signalB?.remainingPct ?? 100;
            return remB - remA;
        });
        return available[0];
    }
    /**
     * Clear stale signals
     */
    clearStale() {
        const cutoff = Date.now() - this.staleThresholdMs;
        for (const entry of Array.from(this.signals.entries())) {
            const [key, sigs] = entry;
            const fresh = sigs.filter((s) => Date.parse(s.capturedAt) >= cutoff);
            if (fresh.length === 0) {
                this.signals.delete(key);
            }
            else {
                this.signals.set(key, fresh);
            }
        }
    }
    /**
     * Generate quota report
     */
    generateReport(providers) {
        const lines = ["Quota Status Report", "=".repeat(40), ""];
        for (const provider of providers) {
            const state = this.getProviderState(provider);
            const latest = this.getLatestSignal(provider);
            const status = state.exhausted
                ? "EXHAUSTED"
                : state.limited
                    ? "LIMITED"
                    : "AVAILABLE";
            lines.push(`${provider}: ${status}`);
            if (latest) {
                lines.push(`  Latest: ${latest.usedPct ?? 0}% used`);
                if (latest.resetsAt) {
                    const wait = Date.parse(latest.resetsAt) - Date.now();
                    if (wait > 0) {
                        lines.push(`  Resets: in ${Math.ceil(wait / 60000)} minutes`);
                    }
                }
                lines.push(`  Source: ${latest.source}`);
            }
            lines.push("");
        }
        return lines.join("\n");
    }
}
/**
 * Parse quota signal from MiniMax error
 */
export function parseMiniMaxError(error) {
    const e = error;
    const msg = String(e.message ?? e.error ?? "");
    // MiniMax quota error: "Error code: 2056 - Rate limit exceeded. Retry after..."
    if (msg.includes("2056") ||
        msg.includes("quota") ||
        msg.includes("rate limit")) {
        // Try to extract retry time
        const retryMatch = msg.match(/retry after (\d+) (seconds?|minutes?)/i);
        let retryAfterMs;
        if (retryMatch) {
            const value = parseInt(retryMatch[1], 10);
            const unit = retryMatch[2].toLowerCase();
            retryAfterMs = unit.startsWith("minute")
                ? value * 60 * 1000
                : value * 1000;
        }
        return {
            provider: "minimax",
            windowType: "5h",
            usedPct: 100,
            remainingPct: 0,
            exhausted: true,
            source: "api_response",
            capturedAt: new Date().toISOString(),
            retryAfterMs,
        };
    }
    return null;
}
/**
 * Parse quota signal from OpenAI error
 */
export function parseOpenAIError(error) {
    const e = error;
    const code = String(e.code ?? "");
    const msg = String(e.message ?? e.error ?? "");
    if (code === "insufficient_quota" || code === "context_length_exceeded") {
        return {
            provider: "openai",
            windowType: "daily",
            usedPct: 100,
            remainingPct: 0,
            exhausted: true,
            source: "api_response",
            capturedAt: new Date().toISOString(),
        };
    }
    if (msg.includes("429")) {
        const retryMatch = msg.match(/retry after (\d+) (seconds?|minutes?)/i);
        let retryAfterMs;
        if (retryMatch) {
            const value = parseInt(retryMatch[1], 10);
            const unit = retryMatch[2].toLowerCase();
            retryAfterMs = unit.startsWith("minute")
                ? value * 60 * 1000
                : value * 1000;
        }
        return {
            provider: "openai",
            windowType: "5h",
            usedPct: 100,
            remainingPct: 0,
            exhausted: true,
            source: "api_response",
            capturedAt: new Date().toISOString(),
            retryAfterMs,
        };
    }
    return null;
}
