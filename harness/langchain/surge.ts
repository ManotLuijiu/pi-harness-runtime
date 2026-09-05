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
 * Classify an unknown error as a transient provider surge (MiniMax).
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

// ─── GLM Quota Classification ─────────────────────────────────────────────────

/** Matches the reset-at timestamp from a GLM 1308 error. */
const GLM_RESET_AT = /reset at (\d{4}-\d{2}-\d{2}[T ]?\d{2}:\d{2}:\d{2})/i;

/**
 * Add 1 calendar day to an ISO date string "YYYY-MM-DDTHH:MM:SS".
 * Used to shift the reset date when it has already passed.
 */
function _shiftDateByOneDay(isoDateTime: string): string {
	const d = new Date(isoDateTime + "Z");
	d.setUTCDate(d.getUTCDate() + 1);
	// Re-format: YYYY-MM-DDTHH:MM:SS  (always 19 chars, seconds included)
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	// Preserve the time part from the original string
	const timePart = isoDateTime.slice(11); // "HH:MM:SS"
	return `${yyyy}-${mm}-${dd}T${timePart}`;
}

/**
 * Classify a GLM 1308 quota exhaustion error.
 * Returns the reset-at ISO timestamp, or null if not a GLM quota error.
 */
export function classifyGLMQuota(err: unknown): GLMQuotaSignal | null {
	const sourceText =
		err instanceof Error
			? err.message
			: typeof err === "string"
				? err
				: String(err);

	// Detect GLM 1308 — quota exhaustion
	const has1308 = /"code"\s*:\s*"1308"|code.*1308/i.test(sourceText);
	const hasReset = GLM_RESET_AT.test(sourceText);
	if (!has1308 && !hasReset) return null;

	// Extract reset timestamp
	const match = sourceText.match(GLM_RESET_AT);
	if (!match) {
		// 1308 without a reset time — use a conservative default (5 min)
		return {
			resetAt: new Date(Date.now() + 5 * 60_000).toISOString(),
			resetAtEpoch: Date.now() + 5 * 60_000,
			sourceText,
		};
	}

	// Normalise: space → T, then ensure HH:MM:SS (append :00 if only HH:MM)
	const normalised = match[1].replace(" ", "T");
	// "2026-09-04T20:29:24" (19 chars, with seconds) → use as-is
	// "2026-09-04T20:29"    (16 chars, no seconds)   → append :00
	const resetAt = normalised.length === 16 ? `${normalised}:00` : normalised;
	// Parse as UTC so the date string is preserved exactly (no TZ shift).
	const resetAtEpoch = new Date(resetAt + "Z").getTime();
	const now = Date.now();

	// If the parsed time is in the past, the date is already "next occurrence".
	// Preserve the original resetAt string so callers can include it verbatim.
	const adjustedResetAt =
		resetAtEpoch <= now ? _shiftDateByOneDay(resetAt) : resetAt;
	const adjustedEpoch =
		resetAtEpoch <= now ? resetAtEpoch + 24 * 60 * 60 * 1000 : resetAtEpoch;

	return {
		resetAt: adjustedResetAt,
		resetAtEpoch: adjustedEpoch,
		sourceText,
	};
}

export interface GLMQuotaSignal {
	/** ISO timestamp when the quota resets */
	resetAt: string;
	/** Epoch ms when the quota resets */
	resetAtEpoch: number;
	/** Raw error text for logs */
	sourceText: string;
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

// ─── Retry wrappers ─────────────────────────────────────────────────────────

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
 * Run `fn`, retrying only on surge-classified failures (MiniMax 529/overload)
 * with exponential backoff. Non-surge errors rethrow immediately.
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

// ─── GLM Quota Retry ────────────────────────────────────────────────────────

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
export async function invokeWithGLMRetry<T>(
	fn: () => Promise<T>,
	opts: GLMRetryOptions = {},
): Promise<T> {
	const sleep = opts.sleep ?? realSleep;
	const tickMs = opts.tickMs ?? 30_000;

	let waitingForReset = false;

	while (true) {
		try {
			return await fn();
		} catch (err) {
			const signal = classifyGLMQuota(err);

			if (!signal) throw err; // not a GLM quota error — fail fast

			// If we are already waiting for a reset and get another 1308,
			// ignore it — the existing wait is already in progress.
			if (waitingForReset) {
				// Just log and continue waiting (the sleep loop handles the timeout)
				await sleep(tickMs);
				continue;
			}

			const delayMs = Math.max(0, signal.resetAtEpoch - Date.now());

			opts.onGLMQuota?.(signal);
			waitingForReset = true;

			if (delayMs <= 0) {
				// Reset time already passed — retry immediately
				waitingForReset = false;
				opts.onGLMRetry?.(signal);
				continue;
			}

			// Wait in chunks so onGLMQuota fires periodically (drives countdown display)
			const startMs = Date.now();
			while (Date.now() - startMs < delayMs) {
				await sleep(tickMs);
				// Re-fire the callback to refresh the countdown display
				opts.onGLMQuota?.({
					...signal,
					resetAtEpoch: signal.resetAtEpoch, // unchanged
				});
			}

			// Countdown expired — retry
			waitingForReset = false;
			opts.onGLMRetry?.(signal);
		}
	}
}
