/**
 * Surge auto-resume — 529 / overloaded_error detection, escalation backoff,
 * and a retry wrapper for the daemon's graph invocations.
 *
 * Implements S2 + S4 of wiki/peak-hour-surge-auto-resume.md:
 * seconds-scale blits stay in the provider client; minutes-scale surges are
 * handled HERE with scheduled pauses (3 → 6 → 12 min, jittered, capped).
 *
 * Verdict vocabulary and patterns intentionally match:
 *   - harness/loop-runtime.ts 529 path (commit 9ae0ffd)
 *   - harness/e2e/glm-quota-scraper.ts parseMinimaxOverloadResetTime()
 *   - packages/providers/src/adapters.ts isOverloaded
 *
 * Wiki: wiki/peak-hour-surge-auto-resume.md
 */
const OVERLOADED_PATTERNS = [
    /529/,
    /overloaded_error/i,
    /peak.?hour.*surge/i,
    /(?:overload|surge|busy)/i,
];
const RECOVERY_RANGE = /recovers? within (\d+)\s*[\u2013-]\s*(\d+)\s*minutes/i;
const SIMPLE_DELAY = /retry (?:after|in) (\d+)\s*(seconds?|secs?|s)\b/i;
const RETRY_AFTER_MS = /retry.?after[^0-9]{0,12}(\d{4,})\s*ms/i;
/**
 * Classify an unknown error as a transient provider surge.
 * Returns null for anything that is not a 529/overload-class failure.
 */
export function classifySurge(err) {
    const sourceText = err instanceof Error
        ? err.message
        : typeof err === "string"
            ? err
            : String(err);
    if (!OVERLOADED_PATTERNS.some((p) => p.test(sourceText))) {
        return null;
    }
    // "recovers within 1–5 minutes" → midpoint (3 min)
    const range = sourceText.match(RECOVERY_RANGE);
    if (range) {
        const min = Number.parseInt(range[1], 10);
        const max = Number.parseInt(range[2], 10);
        if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
            return {
                retryAfterMs: Math.round(((min + max) / 2) * 60_000),
                explicit: true,
                sourceText,
            };
        }
    }
    // "retry after 30 seconds"
    const simple = sourceText.match(SIMPLE_DELAY);
    if (simple) {
        const secs = Number.parseInt(simple[1], 10);
        if (Number.isFinite(secs) && secs > 0) {
            return {
                retryAfterMs: secs * 1000,
                explicit: true,
                sourceText,
            };
        }
    }
    // "retry-after 120000ms" (header-style)
    const ms = sourceText.match(RETRY_AFTER_MS);
    if (ms) {
        const val = Number.parseInt(ms[1], 10);
        if (Number.isFinite(val) && val > 0) {
            return { retryAfterMs: val, explicit: true, sourceText };
        }
    }
    // Overload-class error without a stated delay → conservative default
    return { retryAfterMs: 120_000, explicit: false, sourceText };
}
const DEFAULT_SURGE_POLICY = {
    multiplier: 2,
    minDelayMs: 30_000,
    maxDelayMs: 15 * 60_000,
    jitterRatio: 0.2,
    maxAttempts: 5,
};
/**
 * Deterministic delay computation (unit-testable, no timers).
 * `rand` in [0,1] controls jitter; omit it for zero jitter.
 */
export function computeSurgeDelayMs(signal, attempt, policy = {}, rand) {
    const p = { ...DEFAULT_SURGE_POLICY, ...policy };
    const base = p.baseDelayMs ?? signal.retryAfterMs;
    const escalated = base * p.multiplier ** Math.max(0, attempt - 1);
    const clamped = Math.min(Math.max(escalated, p.minDelayMs), p.maxDelayMs);
    if (rand === undefined || p.jitterRatio === 0)
        return clamped;
    const jitter = clamped * p.jitterRatio * (2 * rand - 1);
    return Math.min(Math.max(clamped + jitter, p.minDelayMs), p.maxDelayMs);
}
// ─── Scheduler ──────────────────────────────────────────────────────────────
/** Attempt counter with escalation; persists across a task's lifetime. */
export class SurgeScheduler {
    attempt = 0;
    policy;
    constructor(policy = {}) {
        this.policy = { ...DEFAULT_SURGE_POLICY, ...policy };
    }
    /** Next attempt number, or null when maxAttempts is exhausted. */
    nextAttempt() {
        if (this.attempt >= this.policy.maxAttempts)
            return null;
        this.attempt += 1;
        return this.attempt;
    }
    get attempts() {
        return this.attempt;
    }
    delayFor(signal, rand) {
        return computeSurgeDelayMs(signal, this.attempt, this.policy, rand);
    }
}
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Run `fn`, retrying only on surge-classified failures with escalated,
 * jittered pauses. Non-surge errors rethrow immediately. On exhaustion the
 * last error is rethrown after `onExhausted`.
 */
export async function invokeWithSurgeRetry(fn, opts = {}) {
    const scheduler = new SurgeScheduler(opts.policy);
    const sleep = opts.sleep ?? realSleep;
    for (;;) {
        try {
            return await fn();
        }
        catch (err) {
            const signal = classifySurge(err);
            if (!signal)
                throw err; // not a surge — fail fast
            const attempt = scheduler.nextAttempt();
            if (attempt === null) {
                opts.onExhausted?.(signal);
                throw err;
            }
            const delayMs = scheduler.delayFor(signal, Math.random());
            opts.onSurge?.({ attempt, delayMs, signal });
            await sleep(delayMs);
        }
    }
}
//# sourceMappingURL=surge.js.map