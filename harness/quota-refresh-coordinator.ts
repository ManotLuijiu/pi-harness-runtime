/**
 * The shared quota refresh.
 *
 * A quota refresh reaches the provider: it costs a request and it can
 * open a browser. Several things can ask for one at the same time (a
 * watcher event, a periodic tick, a command), and two parallel refreshes
 * would mean two browser captures and two chances to trip a rate limit.
 *
 * The coordinator owns one refresh at a time. A request that arrives while
 * a refresh runs joins that refresh instead of starting a second one, and
 * every requester sees the same outcome.
 *
 * The refresh runs outside the model: it never asks a model anything, it
 * only calls the provider.
 */

/** Which credential the refresh used. */
export type QuotaAuthSource =
	| "browser-profile"
	| "cookie-cache"
	| "none";

/** The outcome of a refresh. */
export interface QuotaRefreshOutcome {
	/** Whether the provider answered with usable quota data. */
	ok: boolean;
	/** Which credential the refresh used. */
	source: QuotaAuthSource;
	/**
	 * A safe reason when the refresh failed.
	 *
	 * The reason names the failure, never a credential: no cookie value, no
	 * cookie name, no token, no raw response body.
	 */
	reason?: string;
	/** When the refresh ran, in epoch milliseconds. */
	at?: number;
	/** What asked for the refresh. */
	trigger?: string;
}

/** The options of the coordinator. */
export interface QuotaRefreshCoordinatorOptions {
	/** The refresh itself. It must never throw. */
	refresh: () => Promise<QuotaRefreshOutcome>;
	/** The clock. Default: `Date.now`. */
	now?: () => number;
	/** An optional log sink for the outcome. */
	logger?: (message: string) => void;
}

/**
 * One refresh at a time, shared by every requester.
 */
export class QuotaRefreshCoordinator {
	private readonly refreshFn: () => Promise<QuotaRefreshOutcome>;
	private readonly now: () => number;
	private readonly logger: ((message: string) => void) | undefined;
	private inFlight: Promise<QuotaRefreshOutcome> | null = null;
	private currentToken: object | null = null;
	private last: QuotaRefreshOutcome | null = null;

	constructor(options: QuotaRefreshCoordinatorOptions) {
		this.refreshFn = options.refresh;
		this.now = options.now ?? (() => Date.now());
		this.logger = options.logger;
	}

	/** Whether a refresh is running right now. */
	get isRefreshing(): boolean {
		return this.inFlight !== null;
	}

	/** The outcome of the last refresh, or null when none ran yet. */
	get lastOutcome(): QuotaRefreshOutcome | null {
		return this.last;
	}

	/**
	 * Ask for a refresh.
	 *
	 * A request that arrives while a refresh runs joins that refresh: one
	 * fetch, one outcome, every requester sees the same result.
	 */
	request(trigger: string): Promise<QuotaRefreshOutcome> {
		if (this.inFlight) {
			this.logger?.(
				`quota refresh already running; ${trigger} joins the running refresh`,
			);
			return this.inFlight;
		}

		const token = {};
		this.currentToken = token;
		const run = (async (): Promise<QuotaRefreshOutcome> => {
			let outcome: QuotaRefreshOutcome;
			try {
				outcome = await this.refreshFn();
			} catch (error) {
				outcome = {
					ok: false,
					source: "none",
					reason: error instanceof Error ? error.message : String(error),
					at: this.now(),
					trigger,
				};
			}
			const settled: QuotaRefreshOutcome = {
				...outcome,
				at: outcome.at ?? this.now(),
				trigger: outcome.trigger ?? trigger,
			};
			this.last = settled;
			this.logger?.(
				`quota refresh (${settled.trigger}) via ${settled.source}: ${settled.ok ? "ok" : `failed (${settled.reason ?? "unknown"})`}`,
			);
			// The slot is released before the promise settles, so a request
			// that follows the await starts a new refresh.
			if (this.currentToken === token) {
				this.currentToken = null;
				this.inFlight = null;
			}
			return settled;
		})();

		this.inFlight = run;
		return run;
	}
}
