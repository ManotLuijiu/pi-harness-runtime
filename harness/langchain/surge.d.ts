/**
 * Surge auto-resume — 529 / overloaded_error (MiniMax) + 1308 (GLM quota) detection,
 * escalation backoff, and retry wrappers for the daemon's graph invocations.
 *
 * Two wrappers:
 *   invokeWithSurgeRetry     — MiniMax 529/overload; exponential backoff
 *   invokeWithGLMRetry       — GLM 1308 quota; waits until reset time
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
 * Classify an unknown error as a transient provider surge (MiniMax).
 * Returns null for anything that is not a 529/overload-class failure.
 */
export declare function classifySurge(err: unknown): SurgeSignal | null;
/**
 * Classify a GLM 1308 quota exhaustion error.
 * Returns the reset-at ISO timestamp, or null if not a GLM quota error.
 */
export declare function classifyGLMQuota(err: unknown): GLMQuotaSignal | null;
export interface GLMQuotaSignal {
   /** ISO timestamp when the quota resets */
   resetAt: string;
   /** Epoch ms when the quota resets */
   resetAtEpoch: number;
   /** Raw error text for logs */
   sourceText: string;
}
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
export declare function computeSurgeDelayMs(
   signal: SurgeSignal,
   attempt: number,
   policy?: Partial<SurgePolicy>,
   rand?: number,
): number;
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
 * Run `fn`, retrying only on surge-classified failures (MiniMax 529/overload)
 * with exponential backoff. Non-surge errors rethrow immediately.
 */
export declare function invokeWithSurgeRetry<T>(
   fn: () => Promise<T>,
   opts?: SurgeRetryOptions,
): Promise<T>;
export interface GLMRetryOptions {
   /** Called when GLM quota exhaustion is detected (for status-line countdown) */
   onGLMQuota?: (signal: GLMQuotaSignal) => void;
   /** Called after the countdown expires and the loop retries */
   onGLMRetry?: (signal: GLMQuotaSignal) => void;
   /** Called when the GLM quota error is non-retryable (e.g., no reset time) */
   onGLMExhausted?: (signal: GLMQuotaSignal) => void;
   /** Injectable sleep for tests. Default: real setTimeout */
   sleep?: (ms: number) => Promise<void>;
   /** How often to tick the countdown callback (default: 30s) */
   tickMs?: number;
}
/**
 * Run `fn`, retrying on GLM 1308 quota errors.
 * After the first 1308, waits until the reset time before retrying.
 * Subsequent 1308s within the same wait window are silently ignored.
 * Non-GLM-quota errors rethrow immediately.
 */
export declare function invokeWithGLMRetry<T>(
   fn: () => Promise<T>,
   opts?: GLMRetryOptions,
): Promise<T>;
//# sourceMappingURL=surge.d.ts.map
