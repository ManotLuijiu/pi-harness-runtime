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

// ─── Classification ─────────────────────────────────────────────────────────

export interface SurgeSignal {
	/** Parsed recovery delay in ms (midpoint of the stated range, or fallback) */
	retryAfterMs: number;
	/** True when the delay came from an explicit provider statement */
	explicit: boolean;
	/** Raw error text for logs */
	sourceText: string;
}

const OVERLOADED_PATTERNS: RegExp[] = [
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
export function classifySurge(err: unknown): SurgeSignal | null {
	const sourceText =
		err instanceof Error
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
		const min = Number.parseInt(range[1] as string, 10);
		const max = Number.parseInt(range[2] as string, 10);
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
		const secs = Number.parseInt(simple[1] as string, 10);
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
		const val = Number.parseInt(ms[1] as string, 10);
		if (Number.isFinite(val) && val > 0) {
			return { retryAfterMs: val, explicit: true, sourceText };
		}
	}

	// Overload-class error without a stated delay → conservative default
	return { retryAfterMs: 120_000, explicit: false, sourceText };
}

// ─── Policy ─────────────────────────────────────────────────────────────────

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

const DEFAULT_SURGE_POLICY: SurgePolicy = {
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
export function computeSurgeDelayMs(
	signal: SurgeSignal,
	attempt: number,
	policy: Partial<SurgePolicy> = {},
	rand?: number,
): number {
	const p = { ...DEFAULT_SURGE_POLICY, ...policy };
	const base = p.baseDelayMs ?? signal.retryAfterMs;
	const escalated = base * p.multiplier ** Math.max(0, attempt - 1);
	const clamped = Math.min(Math.max(escalated, p.minDelayMs), p.maxDelayMs);
	if (rand === undefined || p.jitterRatio === 0) return clamped;
	const jitter = clamped * p.jitterRatio * (2 * rand - 1);
	return Math.min(Math.max(clamped + jitter, p.minDelayMs), p.maxDelayMs);
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

/** Attempt counter with escalation; persists across a task's lifetime. */
export class SurgeScheduler {
	private attempt = 0;
	private readonly policy: SurgePolicy;

	constructor(policy: Partial<SurgePolicy> = {}) {
		this.policy = { ...DEFAULT_SURGE_POLICY, ...policy };
	}

	/** Next attempt number, or null when maxAttempts is exhausted. */
	nextAttempt(): number | null {
		if (this.attempt >= this.policy.maxAttempts) return null;
		this.attempt += 1;
		return this.attempt;
	}

	get attempts(): number {
		return this.attempt;
	}

	delayFor(signal: SurgeSignal, rand?: number): number {
		return computeSurgeDelayMs(signal, this.attempt, this.policy, rand);
	}
}

// ─── Retry wrapper ──────────────────────────────────────────────────────────

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

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying only on surge-classified failures with escalated,
 * jittered pauses. Non-surge errors rethrow immediately. On exhaustion the
 * last error is rethrown after `onExhausted`.
 */
export async function invokeWithSurgeRetry<T>(
	fn: () => Promise<T>,
	opts: SurgeRetryOptions = {},
): Promise<T> {
	const scheduler = new SurgeScheduler(opts.policy);
	const sleep = opts.sleep ?? realSleep;

	for (;;) {
		try {
			return await fn();
		} catch (err) {
			const signal = classifySurge(err);
			if (!signal) throw err; // not a surge — fail fast

			const attempt = scheduler.nextAttempt();
			if (attempt === null) {
				opts.onExhausted?.(signal);
				throw err;
			}

			const delayMs = scheduler.delayFor(
				signal,
				Math.random(), // jitter draw
			);
			opts.onSurge?.({ attempt, delayMs, signal });
			await sleep(delayMs);
		}
	}
}
