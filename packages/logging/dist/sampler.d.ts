/**
 * Sampling for the centralized log pipeline.
 *
 * Sampling protects the transport budget, not the producer: a chatty
 * component must not be able to flood R2 (or the webhook server) with
 * debug-level noise.
 *
 * Three independent gates:
 *   1. minimum level  - everything below the configured level is dropped
 *   2. sample rate    - debug records are kept deterministically per event
 *   3. rate limit     - a cap per source+event per minute
 *
 * Errors bypass the sample rate and the rate limit. Losing an error to
 * save a request is the wrong trade.
 */
import { type LogLevel, type LogRecord } from "./types.js";
export interface SamplingPolicy {
    /** Records below this level are dropped. Default "info". */
    minLevel: LogLevel;
    /** Fraction of debug records kept, 0..1. Default 0.1. */
    sampleRate: number;
    /** Max records per source+event per minute (errors exempt). Default 60. */
    rateLimitPerMinute: number;
}
export declare const DEFAULT_SAMPLING_POLICY: SamplingPolicy;
export declare class LogSampler {
    private readonly policy;
    private readonly counters;
    constructor(policy?: Partial<SamplingPolicy>);
    getPolicy(): SamplingPolicy;
    /** True when the record should be kept. */
    shouldLog(record: LogRecord, now?: number): boolean;
    private allowByRateLimit;
    /** Forget the rate-limit counters (used by tests and by long sessions). */
    reset(): void;
}
//# sourceMappingURL=sampler.d.ts.map