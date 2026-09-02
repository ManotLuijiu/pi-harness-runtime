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
export interface SurgeSignal {
    /** Parsed recovery delay in ms (midpoint of the stated range, or fallback) */
    retryAfterMs: number;
    /** True when the delay came from an explicit provider statement */
    explicit: boolean;
    /** Raw error text for logs */
    sourceText: string;
}
/**
 * Classify an unknown error as a transient provider surge.
 * Returns null for anything that is not a 529/overload-class failure.
 */
export declare function classifySurge(err: unknown): SurgeSignal | null;
export interface SurgePolicy {
    /** Override the signal's parsed delay (ms). Default: use the signal. */
    baseDelayMs?: number;
    /** Delay multiplier per attempt. Default: 2 (3 → 6 → 12 min) */
    multiplier: number;
    /** Floor for any wait. Default: 30_000 (never hammer a surging provider) */
    minDelayMs: number;
    /** Ceiling for any wait. Default: 15 min */
    maxDelayMs: number;
    /** ± ratio applied as jitter. Default: 0.2 */
    jitterRatio: number;
    /** Max surge pauses before giving up. Default: 5 */
    maxAttempts: number;
}
/**
 * Deterministic delay computation (unit-testable, no timers).
 * `rand` in [0,1] controls jitter; omit it for zero jitter.
 */
export declare function computeSurgeDelayMs(signal: SurgeSignal, attempt: number, policy?: Partial<SurgePolicy>, rand?: number): number;
/** Attempt counter with escalation; persists across a task's lifetime. */
export declare class SurgeScheduler {
    private attempt;
    private readonly policy;
    constructor(policy?: Partial<SurgePolicy>);
    /** Next attempt number, or null when maxAttempts is exhausted. */
    nextAttempt(): number | null;
    get attempts(): number;
    delayFor(signal: SurgeSignal, rand?: number): number;
}
export interface SurgeRetryOptions {
    policy?: Partial<SurgePolicy>;
    /** Called before each surge pause (logging / notifications) */
    onSurge?: (info: {
        attempt: number;
        delayMs: number;
        signal: SurgeSignal;
    }) => void;
    /** Called once when attempts are exhausted (before rethrow) */
    onExhausted?: (signal: SurgeSignal) => void;
    /** Injectable sleep for tests. Default: real setTimeout */
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Run `fn`, retrying only on surge-classified failures with escalated,
 * jittered pauses. Non-surge errors rethrow immediately. On exhaustion the
 * last error is rethrown after `onExhausted`.
 */
export declare function invokeWithSurgeRetry<T>(fn: () => Promise<T>, opts?: SurgeRetryOptions): Promise<T>;
//# sourceMappingURL=surge.d.ts.map