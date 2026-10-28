/**
 * The live countdown of a pending question.
 *
 * The harness asks a human a question and waits. The wait has a deadline,
 * and the countdown shows the remaining time in the status row of the TUI
 * and starts the decision of the judge exactly at that deadline.
 *
 * The module owns the two policies of the wait:
 *
 * - the first countdown counts down to the deadline of the decision, which
 *   is derived from the moment the wait started,
 * - the recheck counts down to the next attempt, after the judge asked to
 *   wait longer.
 *
 * The caller cannot pass a deadline of its own: the displayed deadline and
 * the deadline the judge uses therefore cannot drift apart.
 *
 * The countdown is bound to one request. Every start replaces the previous
 * binding and every stop releases the timer, so there is never more than
 * one countdown and never a timer without a request.
 */

/** What the countdown counts to. */
export type CountdownMode = "initial" | "recheck";

/** The state of the countdown that is drawn in the status row. */
export interface CountdownView {
	/** The request the countdown belongs to. */
	requestId: string;
	/** The milliseconds that are left. Never negative. */
	remainingMs: number;
	/** The remaining time as "MM:SS". */
	remaining: string;
	/** What the countdown counts to. */
	mode: CountdownMode;
}

/** The dependencies of a countdown. */
export interface PendingCountdownDeps {
	/** Draw the countdown in the status row. */
	render: (view: CountdownView) => void;
	/** The deadline was reached and the decision is due. */
	onDeadline: (requestId: string) => void;
	/**
	 * Is the request still the pending one?
	 *
	 * A tick of a question that was answered or replaced in the meantime
	 * must not redraw its status and must not trigger a decision.
	 */
	isPending: (requestId: string) => boolean;
	/** A failing callback of the countdown is reported here. */
	onError?: (error: unknown) => void;
	/** The wait is over: the status row is cleared. */
	onStop?: (requestId: string | null) => void;
	/** The minutes the judge waits for a human answer. */
	waitMinutes: number;
	/** The milliseconds until the next attempt after the judge asked to wait. */
	recheckIntervalMs: number;
	/** The clock (the tests drive it). */
	now?: () => number;
	/** The timer that drives the ticks (the tests drive it). */
	setInterval?: (callback: () => void, ms: number) => unknown;
	/** The timer that stops the ticks (the tests drive it). */
	clearInterval?: (handle: unknown) => void;
	/** The tick interval in milliseconds. */
	tickMs?: number;
}

/** The milliseconds between two ticks of the display. */
const COUNTDOWN_TICK_MS = 1_000;

/**
 * The smallest tick interval.
 *
 * A shorter interval would repaint the status row faster than a reader can
 * follow it and would waste the event loop of the harness.
 */
const MIN_TICK_MS = 100;

/**
 * The deadline of the decision.
 *
 * The deadline is derived from the moment the wait started, so the
 * countdown and the judge share one timestamp.
 */
export function decisionDeadlineAt(startedAt: number, waitMinutes: number): number {
	const minutes = Number.isFinite(waitMinutes) ? Math.max(0, waitMinutes) : 0;
	const started = Number.isFinite(startedAt) ? startedAt : 0;
	return started + minutes * 60_000;
}

/**
 * The remaining time as "MM:SS".
 *
 * A time that is not a number is shown as an empty countdown: a status row
 * must never claim a time that does not exist.
 */
export function formatRemainingTime(remainingMs: number): string {
	const safeMs = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : 0;
	const totalSeconds = Math.floor(safeMs / 1_000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** The binding of a running countdown. */
interface CountdownBinding {
	requestId: string;
	deadlineAt: number;
	mode: CountdownMode;
}

/**
 * The countdown of one pending question.
 *
 * The countdown renders at once: the status row must show the remaining
 * time without waiting for the first tick.
 */
export class PendingQuestionCountdown {
	private readonly deps: PendingCountdownDeps;
	private readonly now: () => number;
	private readonly startTimer: (callback: () => void, ms: number) => unknown;
	private readonly stopTimer: (handle: unknown) => void;
	private readonly tickMs: number;
	private handle: unknown = null;
	private binding: CountdownBinding | null = null;
	/**
	 * Bumped on every start and every stop.
	 *
	 * A tick of an older generation belongs to a binding that is gone: it is
	 * ignored instead of redrawing a status or triggering a decision.
	 */
	private generation = 0;
	/**
	 * True while the countdown owns the wait.
	 *
	 * The countdown stays engaged after its deadline fired, until the
	 * decision path stops it or replaces it. The fallback poll uses this to
	 * stay out of the way of the accurate timer.
	 */
	private engaged = false;
	/**
	 * True when the deadline fired and the decision did not start yet.
	 *
	 * The countdown owns the wait in that state, but it has no timer: the
	 * caller arms it again when the decision did not start.
	 */
	private deadlineFired = false;

	constructor(deps: PendingCountdownDeps) {
		this.deps = deps;
		this.now = deps.now ?? (() => Date.now());
		this.startTimer =
			deps.setInterval ??
			((callback, ms) => setInterval(callback, ms) as unknown);
		this.stopTimer =
			deps.clearInterval ??
			((handle) => clearInterval(handle as NodeJS.Timeout));
		this.tickMs = Math.max(MIN_TICK_MS, deps.tickMs ?? COUNTDOWN_TICK_MS);
	}

	/** Does the countdown own the current wait? */
	get active(): boolean {
		return this.engaged;
	}

	/** Did the deadline fire and is the decision still due? */
	get fired(): boolean {
		return this.deadlineFired;
	}

	/** The request the countdown belongs to. */
	get requestId(): string | null {
		return this.binding?.requestId ?? null;
	}

	/** What the countdown counts to. */
	get mode(): CountdownMode | null {
		return this.binding?.mode ?? null;
	}

	/**
	 * Start the countdown of a request, or replace the running one.
	 *
	 * The deadline of the decision is derived from the moment the wait
	 * started: the caller passes that timestamp, the countdown computes the
	 * deadline. The countdown and the judge therefore share one timestamp.
	 */
	start(requestId: string, startedAt: number): void {
		this.begin(requestId, decisionDeadlineAt(startedAt, this.deps.waitMinutes), "initial");
	}

	/**
	 * Start the countdown of the next attempt.
	 *
	 * The judge asked to wait longer: the countdown counts down to the next
	 * attempt instead of to the deadline of the decision.
	 */
	startRecheck(requestId: string): void {
		this.begin(requestId, this.now() + this.deps.recheckIntervalMs, "recheck");
	}

	/**
	 * Stop the countdown and release its timer.
	 *
	 * Stopping is idempotent: a countdown that is not running can be stopped
	 * as often as the cleanup paths need. The status row is cleared with it,
	 * so a dead countdown never leaves a row that claims a decision is due.
	 */
	stop(): void {
		const requestId = this.binding?.requestId ?? null;
		this.engaged = false;
		this.deadlineFired = false;
		this.generation += 1;
		this.clearTimer();
		this.binding = null;
		this.safeCall(() => this.deps.onStop?.(requestId));
	}

	/** Bind the countdown to a request and start its timer. */
	private begin(requestId: string, deadlineAt: number, mode: CountdownMode): void {
		this.clearTimer();
		this.generation += 1;
		const generation = this.generation;
		this.binding = { requestId, deadlineAt, mode };
		this.engaged = true;
		this.deadlineFired = false;
		try {
			this.handle = this.startTimer(() => this.tick(generation), this.tickMs);
		} catch (error) {
			// The timer could not be created: the countdown owns nothing, so
			// it must not claim the wait. The row of the countdown is
			// cleared with it, so no row claims a decision that is not due.
			this.engaged = false;
			this.binding = null;
			this.safeCall(() => this.deps.onStop?.(requestId));
			this.report(error);
			return;
		}
		this.tick(generation);
	}

	/**
	 * One tick of the countdown.
	 *
	 * The tick is a no-op when it belongs to a binding that is gone, or
	 * when the request it counts for is no longer the pending one.
	 */
	private tick(generation: number): void {
		if (!this.engaged || generation !== this.generation) return;
		const binding = this.binding;
		if (!binding) return;

		let remainingMs: number;
		try {
			if (!this.deps.isPending(binding.requestId)) {
				// The question was answered or replaced: the countdown of
				// that question is over.
				this.stop();
				return;
			}
			// The callback may have stopped the countdown: the binding of
			// this tick is gone and must not be drawn any more.
			if (!this.engaged || generation !== this.generation) return;
			remainingMs = Math.max(0, binding.deadlineAt - this.now());
		} catch (error) {
			// A failing callback must never escape the timer: the countdown
			// stops and the failure is reported.
			this.stop();
			this.report(error);
			return;
		}

		if (remainingMs <= 0) {
			// The deadline is reached. The timer stops, the countdown stays
			// engaged until the decision path stops it or replaces it, so
			// the fallback poll does not start a second decision.
			this.clearTimer();
			this.deadlineFired = true;
			// The countdown reaches its zero before the decision starts.
			this.safeRender({
				requestId: binding.requestId,
				remainingMs: 0,
				remaining: formatRemainingTime(0),
				mode: binding.mode,
			});
			// A failing decision handler must not leave a countdown that owns
			// the wait without a timer: the countdown stops, so the fallback
			// poll can take over.
			try {
				this.deps.onDeadline(binding.requestId);
			} catch (error) {
				this.stop();
				this.report(error);
			}
			return;
		}

		this.safeRender({
			requestId: binding.requestId,
			remainingMs,
			remaining: formatRemainingTime(remainingMs),
			mode: binding.mode,
		});
	}

	/** Draw the countdown, and report a failing status row. */
	private safeRender(view: CountdownView): void {
		try {
			this.deps.render(view);
		} catch (error) {
			this.stop();
			this.report(error);
		}
	}

	/** Run a callback of the countdown without letting it escape. */
	private safeCall(action: () => void): void {
		try {
			action();
		} catch (error) {
			this.report(error);
		}
	}

	/** Report a failure without letting the report escape. */
	private report(error: unknown): void {
		try {
			this.deps.onError?.(error);
		} catch {
			// The report of a failure must not become a new failure.
		}
	}

	/** Release the timer of the countdown. */
	private clearTimer(): void {
		if (this.handle === null) return;
		const handle = this.handle;
		this.handle = null;
		try {
			this.stopTimer(handle);
		} catch (error) {
			// The timer is already released from the point of view of the
			// countdown: the failure is reported, nothing is left behind.
			this.report(error);
		}
	}
}
