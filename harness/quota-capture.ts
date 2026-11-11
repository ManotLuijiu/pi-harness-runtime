/**
 * The quota capture that a provider recovery needs.
 *
 * The recovery decides when to continue from a capture of the quota, and
 * the row of the mirror can be hours old. A capture that is forced before
 * the decision refreshes that row.
 *
 * The capture is the one of the harness: it refreshes the mirror and
 * nothing else. It never charges an attempt of the recovery and it never
 * schedules anything.
 *
 * A capture that failed is remembered as a failure: the row of the mirror
 * is the old one then, and an old row cannot prove a deadline.
 */

/** The time a capture of the same failure may be reused. */
export const QUOTA_CAPTURE_REUSE_MS = 2 * 60_000;

/** The time the recovery waits for the capture. */
export const QUOTA_CAPTURE_WAIT_MS = 15_000;

/** What the last capture did. */
export interface QuotaCaptureOutcome {
	/** The provider the capture was about. */
	provider: string;
	/** Did the capture work? */
	ok: boolean;
	/** When the capture ended. */
	at: number;
}

/** The dependencies of the controller. */
export interface QuotaCaptureOptions {
	/**
	 * Capture the quota of a provider.
	 *
	 * The result says whether the capture worked. A capture that throws is
	 * a failed capture, not a crash of the harness.
	 */
	capture(provider: string): Promise<boolean>;
	/** The clock of the controller. */
	now?(): number;
	/** The log of the controller. */
	log?(message: string): void;
	/** The time the recovery waits for the capture. */
	waitMs?: number;
	/** The time a capture of the same failure may be reused. */
	reuseMs?: number;
}

/**
 * The capture of the quota of a provider failure.
 *
 * One capture at a time: the browser of the harness is not a resource that
 * is spent twice for one failure.
 */
export class QuotaCaptureController {
	private readonly options: QuotaCaptureOptions;
	private readonly now: () => number;
	private readonly waitMs: number;
	private readonly reuseMs: number;
	private pending: {
		provider: string;
		promise: Promise<boolean>;
		startedAt: number;
	} | null = null;
	private last: QuotaCaptureOutcome | null = null;

	constructor(options: QuotaCaptureOptions) {
		this.options = options;
		this.now = options.now ?? (() => Date.now());
		this.waitMs = options.waitMs ?? QUOTA_CAPTURE_WAIT_MS;
		this.reuseMs = options.reuseMs ?? QUOTA_CAPTURE_REUSE_MS;
	}

	/** The outcome of the last capture. */
	get outcome(): QuotaCaptureOutcome | null {
		return this.last;
	}

	/**
	 * Did the last capture of this provider fail?
	 *
	 * A failed capture means that the row of the mirror is the old one, so
	 * it cannot prove a deadline.
	 */
	failed(provider: string): boolean {
		const outcome = this.last;
		if (!outcome) return false;
		return outcome.provider === provider.toLowerCase() && !outcome.ok;
	}

	/**
	 * Start the capture of a quota failure.
	 *
	 * A capture that is running for the same provider is not started again,
	 * and a capture that ended recently is not repeated: its row is fresh
	 * enough for the decision.
	 */
	begin(provider: string): void {
		const key = provider.toLowerCase();
		const current = this.pending;
		if (
			current &&
			current.provider === key &&
			current.startedAt > this.now() - this.reuseMs
		) {
			return;
		}
		const promise = (async () => {
			try {
				const ok = await this.options.capture(key);
				this.last = { provider: key, ok, at: this.now() };
				return ok;
			} catch (error) {
				this.options.log?.(
					`The forced quota capture of ${key} failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				this.last = { provider: key, ok: false, at: this.now() };
				return false;
			}
		})();
		this.pending = { provider: key, promise, startedAt: this.now() };
	}

	/**
	 * Wait for the capture, within a bound.
	 *
	 * A capture that takes too long is given up: the recovery keeps the
	 * bounded cycle, and the capture that finishes later only refreshes
	 * the mirror.
	 */
	async wait(): Promise<void> {
		const current = this.pending;
		if (!current) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				current.promise,
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, this.waitMs);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}
