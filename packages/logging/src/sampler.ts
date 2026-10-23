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

import { LOG_LEVEL_SEVERITY, type LogLevel, type LogRecord } from "./types.js";

export interface SamplingPolicy {
	/** Records below this level are dropped. Default "info". */
	minLevel: LogLevel;
	/** Fraction of debug records kept, 0..1. Default 0.1. */
	sampleRate: number;
	/** Max records per source+event per minute (errors exempt). Default 60. */
	rateLimitPerMinute: number;
}

export const DEFAULT_SAMPLING_POLICY: SamplingPolicy = {
	minLevel: "info",
	sampleRate: 0.1,
	rateLimitPerMinute: 60,
};

/**
 * Stable hash so the same event keeps the same decision across restarts -
 * a debug event is either always sampled or never, never randomly.
 */
function stableHash(input: string): number {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 0xffffffff;
}

export class LogSampler {
	private readonly policy: SamplingPolicy;
	private readonly counters = new Map<string, { windowStart: number; count: number }>();

	constructor(policy: Partial<SamplingPolicy> = {}) {
		this.policy = { ...DEFAULT_SAMPLING_POLICY, ...policy };
	}

	getPolicy(): SamplingPolicy {
		return { ...this.policy };
	}

	/** True when the record should be kept. */
	shouldLog(record: LogRecord, now: number = Date.now()): boolean {
		if (LOG_LEVEL_SEVERITY[record.level] < LOG_LEVEL_SEVERITY[this.policy.minLevel]) {
			return false;
		}

		if (record.level === "error") return true;

		if (record.level === "debug") {
			const bucket = stableHash(`${record.source}:${record.event}`);
			if (bucket >= this.policy.sampleRate) return false;
		}

		return this.allowByRateLimit(record, now);
	}

	private allowByRateLimit(record: LogRecord, now: number): boolean {
		const limit = this.policy.rateLimitPerMinute;
		if (limit <= 0) return true;

		const key = `${record.source}:${record.event}`;
		const windowStart = Math.floor(now / 60_000) * 60_000;
		const entry = this.counters.get(key);

		if (!entry || entry.windowStart !== windowStart) {
			this.counters.set(key, { windowStart, count: 1 });
			return true;
		}

		if (entry.count >= limit) return false;
		entry.count++;
		return true;
	}

	/** Forget the rate-limit counters (used by tests and by long sessions). */
	reset(): void {
		this.counters.clear();
	}
}
