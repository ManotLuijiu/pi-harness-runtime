import type { TodoItem, TodoContext, TodoProvider } from "./todo-provider.js";
import { createTodoProvider } from "./todo-provider.js";
import {
	buildValidationSteerSuffix,
	formatDuration,
	parseValidationPlan,
	validationBudgetStatus,
	type ValidationBudgetStatus,
	type ValidationState,
} from "./validation-plan.js";
import type { ValidationLedger } from "./validation-ledger.js";

/**
 * Simple debug logger that writes to file, not stdout
 */
const DEBUG_LOG_FILE = "/tmp/pi-harness-debug.log";

/**
 * Watchdog for a dispatch that never settles.
 *
 * A hanging dispatch (a dead transport, a promise that is never resolved) must
 * not block every later continuation: after this timeout the in-flight guard
 * is released so the next decision can try again.
 */
const INFLIGHT_TIMEOUT_MS = 60_000;
function debugLog(component: string, ...args: unknown[]): void {
	try {
		const timestamp = new Date().toISOString();
		const msg = `[${timestamp}] [${component}] ${args.map(a => String(a)).join(" ")}\n`;
		import("node:fs").then(({ appendFileSync }) => {
			appendFileSync(DEBUG_LOG_FILE, msg);
		}).catch(() => {});
	} catch {
		// Silently fail
	}
}

/**
 * Continuation configuration
 */
/**
 * When a guard release arrives while a dispatch is on the wire, the release is
 * dropped (it belongs to the turn that was already running). The guard then
 * stays armed until the safety-net timeout - which would stall the
 * auto-continue for minutes. It is released shortly after instead.
 */
const GUARD_RELEASE_AFTER_DROP_MS = 1000;

export interface ContinuationConfig {
	/** Dispatch function to send messages to the agent (required) */
	dispatch: (content: string) => Promise<void>;
	/** Minimum wait before Jev fallback (ms) */
	jevFallbackMinWaitMs?: number;
	/** Threshold for routine continuation */
	routineThreshold?: number;
	/** Max steer attempts per session */
	maxSteerAttempts?: number;
	/** Enable Jev for ambiguous cases */
	enableJev?: boolean;
	/** Injectable todo provider (defaults to the pi-backed provider) */
	todoProvider?: TodoProvider;
	/**
	 * How long a dispatched continuation may stay "queued" before the guard is
	 * released automatically. Guards are normally released when the agent turn
	 * settles; this is the safety net for a lost settle event.
	 */
	guardReleaseTimeoutMs?: number;
	/**
	 * How long the guard stays armed after a guard release was DROPPED
	 * (it arrived while a dispatch was on the wire). Without this the guard
	 * would stay armed for the full `guardReleaseTimeoutMs` safety net and
	 * the auto-continue would stall for minutes.
	 */
	guardReleaseAfterDropMs?: number;
	/**
	 * Max successful dispatches per session across all items.
	 *
	 * The per-item budget (`maxSteerAttempts`) is reset when the work item
	 * changes, so alternating between two items would never exhaust it. This
	 * session-wide cap bounds such a run.
	 */
	maxTotalSteerAttempts?: number;
	/**
	 * How long the circuit breaker stays open after repeated send failures.
	 *
	 * After the cooldown a single trial dispatch is allowed again.
	 */
	circuitBreakerCooldownMs?: number;
	/**
	 * How many consecutive send failures open the circuit breaker.
	 */
	maxConsecutiveFailures?: number;
	/**
	 * How long a dispatch may stay on the wire before the in-flight guard is
	 * force-released.
	 *
	 * A dispatch that never settles must not block every later continuation.
	 */
	inFlightTimeoutMs?: number;
	/**
	 * Ledger of validation runs.
	 *
	 * When a ledger is wired, the controller knows which tier already ran and
	 * whether the final tier is still pending, and it can pause an item whose
	 * declared time budget is spent.
	 */
	validationLedger?: ValidationLedger;
}

/**
 * What a dispatch wants to send.
 *
 * A dispatch may also abort: the message builder returns the reason and the
 * dispatch is dropped before anything is put on the wire.
 */
type DispatchPayload = { send: string } | { abort: string };

/**
 * Continuation state
 */
export interface ContinuationState {
	sessionId: string;
	generation: number;
	todoRevision: number;
	currentItemId: number | null;
	nextItemId: number | null;
	lastMessageId: string | null;
	continuationQueued: boolean;
	userPaused: boolean;
	explicitPause: boolean;  // True when user explicitly paused
	lastSteerMessage: string | null;
	steerAttemptsForCurrentItem: number;
	lastItemContinued: number | null;
	lastEvaluationResult: string | null;
}

/**
 * Outcome of a steer attempt
 */
export interface SteerResult {
	/** True when the continuation message was actually handed to the agent */
	dispatched: boolean;
	/** Why the dispatch was skipped (only set when dispatched is false) */
	reason?: string;
	/** Attempt counter for the item (successful dispatches only) */
	attempts: number;
	/** Number of dispatches that were blocked by a guard */
	blockedDispatches: number;
}

/**
 * Result of a guarded dispatch.
 *
 * `blocked` distinguishes the two reasons a dispatch does not happen:
 * a guard skipped it (session busy, paused, duplicate, item completed) or
 * the send itself failed. A blocked dispatch is counted separately and never
 * consumes the attempt budget.
 */
export interface GuardedDispatchResult {
	/** True when the continuation message was actually handed to the agent */
	dispatched: boolean;
	/** Why the dispatch did not happen (only set when dispatched is false) */
	reason?: string;
	/** True when a guard skipped the dispatch, false when the send itself failed */
	blocked: boolean;
}

/**
 * Continuation result
 */
export interface ContinuationResult {
	action: "continue" | "stop" | "blocked" | "ask";
	nextItemId?: number;
	question?: string;
	reason?: string;
	/** Budget status of the item the decision was about. */
	budget?: ValidationBudgetStatus;
}

/**
 * Todo-Driven Continuation Controller
 *
 * Evaluates todo state on agent_settled and determines next action.
 */
export class TodoContinuationController {
	private ctx: TodoContext;
	private config: Required<ContinuationConfig>;
	private todoProvider: TodoProvider;

	/**
	 * How long a dispatched continuation may stay queued before the guard is
	 * released automatically (safety net for a lost agent_settled event).
	 */
	private guardReleaseTimeoutMs: number;
	/** Delay before the guard is released after a dropped mid-dispatch release */
	private guardReleaseAfterDropMs: number;

	private state: ContinuationState = {
		sessionId: "",
		generation: 0,
		todoRevision: 0,
		currentItemId: null,
		nextItemId: null,
		lastMessageId: null,
		continuationQueued: false,
		userPaused: false,
		explicitPause: false,
		lastSteerMessage: null,
		steerAttemptsForCurrentItem: 0,
		lastItemContinued: null,
		lastEvaluationResult: null,
	};

	private _inFlightSeq: number | null = null;  // Sequence number of the active dispatch (null = idle)
	private _dispatchSeq = 0;  // Monotonic counter for every dispatch attempt
	private _guardTimer: ReturnType<typeof setTimeout> | null = null;
	private _blockedDispatches = 0;  // Dispatches skipped by a guard (do NOT consume the attempt budget)
	private _pendingGuardRelease: string | null = null;  // Guard release requested while a dispatch was in flight
	private _cancelRequested = false;  // clearQueue()/pause() called while a dispatch was in flight
	private _lastDroppedGuardRelease: string | null = null;  // Reason of the last dropped mid-dispatch release
	private _stalledItemId: number | null = null;  // Item of a dispatch that was force-released by the watchdog
	private _consecutiveFailures = 0;  // Failed sends in a row (circuit breaker)
	private _maxConsecutiveFailures = 3;  // Failed sends tolerated before the breaker opens
	private _lastFailureAt = 0;  // Timestamp of the last failed send (circuit breaker cooldown)
	private _circuitBreakerCooldownMs = 5 * 60 * 1000;  // How long the breaker stays open
	private _inFlightTimeoutMs = INFLIGHT_TIMEOUT_MS;  // Watchdog for a hanging dispatch
	private _attemptsByItem = new Map<number, number>();  // Successful dispatches per item
	private _itemStartedAt = new Map<number, number>();  // First continuation of an item (elapsed-time budget)
	private _totalAttempts = 0;  // Successful dispatches in this session (runaway guard)
	private _maxTotalSteerAttempts = 9;  // Session-wide cap on successful dispatches
	private _disposed = false;  // Set on shutdown: no dispatch and no timer may act anymore
	private _validationLedger?: ValidationLedger;  // Optional ledger of validation runs

	/** True while a dispatch is on the wire */
	private get inFlight(): boolean {
		return this._inFlightSeq !== null;
	}

	constructor(ctx: TodoContext, config?: ContinuationConfig) {
		this.ctx = ctx;
		this.todoProvider = config?.todoProvider ?? createTodoProvider(ctx);
		this.guardReleaseTimeoutMs = config?.guardReleaseTimeoutMs ?? 5 * 60 * 1000;
		this.guardReleaseAfterDropMs = config?.guardReleaseAfterDropMs ?? GUARD_RELEASE_AFTER_DROP_MS;
		this._circuitBreakerCooldownMs = config?.circuitBreakerCooldownMs ?? 5 * 60 * 1000;
		this._maxConsecutiveFailures = config?.maxConsecutiveFailures ?? 3;
		this._inFlightTimeoutMs = config?.inFlightTimeoutMs ?? INFLIGHT_TIMEOUT_MS;
		this._validationLedger = config?.validationLedger;
		this.config = {
			jevFallbackMinWaitMs: 5 * 60 * 1000, // 5 minutes
			routineThreshold: 0.7,
			maxSteerAttempts: 3,
			enableJev: true,
			...config,
		} as Required<ContinuationConfig>;
		this._maxTotalSteerAttempts =
			config?.maxTotalSteerAttempts ?? this.config.maxSteerAttempts * 3;
	}

	/**
	 * Successful dispatches recorded for an item.
	 *
	 * The budget is per item: switching to a different item starts a fresh
	 * budget for that item, but the session-wide cap (`maxTotalSteerAttempts`)
	 * still bounds an alternating run.
	 */
	private attemptsFor(itemId: number): number {
		return this._attemptsByItem.get(itemId) ?? 0;
	}

	/**
	 * Elapsed work time on an item, measured from the first continuation.
	 *
	 * `undefined` means the item was never continued, so no elapsed time can
	 * be reported yet.
	 */
	private elapsedForItem(itemId: number): number | undefined {
		const startedAt = this._itemStartedAt.get(itemId);
		if (startedAt === undefined) return undefined;
		return Date.now() - startedAt;
	}

	/**
	 * Remember when work on an item started (first continuation only).
	 */
	private markItemStarted(itemId: number): void {
		if (!this._itemStartedAt.has(itemId)) this._itemStartedAt.set(itemId, Date.now());
	}

	/**
	 * The validation state of an item, read from the ledger.
	 *
	 * `undefined` when no ledger is wired: the caller then falls back to the
	 * declared plan alone.
	 */
	private validationStateFor(item: TodoItem | undefined): ValidationState | undefined {
		if (!item || !this._validationLedger) return undefined;
		return this._validationLedger.stateFor(item);
	}

	/**
	 * The budget status of an item.
	 *
	 * Only a declared `budgetMinutes` arms a budget - the harness never
	 * invents one, because an invented budget could pause legitimate work.
	 */
	private budgetStatusFor(item: TodoItem | undefined): ValidationBudgetStatus {
		const plan = parseValidationPlan(item);
		return validationBudgetStatus(plan, item ? this.elapsedForItem(item.id) : undefined);
	}

	/**
	 * The reason reported when an item ran out of its declared time budget.
	 */
	private budgetAbortReason(item: TodoItem, budget: ValidationBudgetStatus): string {
		const spent = formatDuration(budget.elapsedMs ?? 0);
		const total = formatDuration(budget.budgetMs ?? 0);
		return `budget exhausted for task ${item.id} (${spent} of ${total}) - pausing at a safe boundary`;
	}

	/**
	 * True while the circuit breaker forbids a send.
	 *
	 * After the cooldown a single trial dispatch is allowed again, so a
	 * transient transport outage does not stop auto-continue forever.
	 */
	private breakerOpen(): boolean {
		if (this._consecutiveFailures < this._maxConsecutiveFailures) return false;
		return Date.now() - this._lastFailureAt < this._circuitBreakerCooldownMs;
	}

	/**
	 * Check if continuation is allowed (not paused, session idle)
	 */
	private canContinue(): boolean {
		// Only an explicit pause blocks the continuation. A temporary pause
		// (user input) is honoured as well - it is cleared by the next
		// decision that is not racing with a running dispatch.
		if (this.state.explicitPause) {
			debugLog("TodoContinuation", "Explicitly paused, not continuing");
			return false;
		}
		if (this.state.userPaused) {
			// NOTE: the temporary pause is auto-cleared by the next decision
			// (see decide()), so this branch only triggers while a dispatch is
			// in flight and the pause was raised after that decision.
			debugLog("TodoContinuation", "User input pending, not continuing");
			return false;
		}
		if (this.ctx.isIdle?.() === false) {
			debugLog("TodoContinuation", "Session not idle, not continuing");
			return false;
		}
		if (this.ctx.hasPendingMessages?.()) {
			debugLog("TodoContinuation", "Pending messages, not continuing");
			return false;
		}
		return true;
	}

	/**
	 * User explicitly paused - only this clears on explicit resume
	 */
	explicitPause(): void {
		debugLog("TodoContinuation", "Explicit pause requested");
		this.state.explicitPause = true;
		this.state.userPaused = true;
		// Disarm the guard completely: keeping continuationQueued set while the
		// release timer is cancelled would block every later dispatch forever.
		this.state.continuationQueued = false;
		this._pendingGuardRelease = null;
		if (this.inFlight) this._cancelRequested = true;
		this.cancelGuardTimer();
	}

	/**
	 * Resume from explicit pause
	 */
	resume(): void {
		if (this.state.explicitPause) {
			debugLog("TodoContinuation", "Resuming from explicit pause");
			this.state.explicitPause = false;
			this.state.userPaused = false;
			this.clearQueue();
		}
		// A resumed session gets a fresh transport budget: an open circuit
		// breaker must not stay open forever.
		this._consecutiveFailures = 0;
		this._lastFailureAt = 0;
	}

	/**
	 * Get current todo snapshot (exposed for task intake)
	 */
	async getSnapshot() {
		return this.todoProvider.getSnapshot();
	}

	/**
	 * Temporary pause for user input processing
	 * Does not require explicit resume
	 */
	tempPause(): void {
		debugLog("TodoContinuation", "Temporary pause for user input");
		this.state.userPaused = true;
		// Same as explicitPause(): the guard must be fully disarmed, otherwise
		// the cancelled release timer leaves the queue flag stuck at true.
		this.state.continuationQueued = false;
		this._pendingGuardRelease = null;
		if (this.inFlight) this._cancelRequested = true;
		this.cancelGuardTimer();
	}

	/**
	 * Clear continuation queue (called when work completes or starts)
	 */
	clearQueue(): void {
		this.state.continuationQueued = false;
		// NOTE: _inFlight is NOT cleared here. It belongs to the dispatch
		// lifecycle and is released in the dispatch's finally block. Clearing it
		// here would re-open the concurrent-dispatch window while a dispatch
		// send is still on the wire.
		// A dispatch that is still on the wire must not re-arm the guard when
		// it completes. The cancel intent is only meaningful for a dispatch
		// that is actually running - otherwise it would disarm the guard of a
		// LATER dispatch.
		if (this.inFlight) this._cancelRequested = true;
		this.cancelGuardTimer();
		debugLog("TodoContinuation", "Continuation queue cleared");
	}

	/**
	 * Release the dispatch guard after a verified lifecycle transition.
	 *
	 * The guard is set when a continuation is handed to the agent and must be
	 * released once that turn has settled - otherwise every later dispatch is
	 * blocked while the attempt budget keeps being consumed.
	 */
	releaseContinuationGuard(reason = "agent settled"): void {
		if (this.inFlight) {
			// A dispatch is still on the wire. Releasing the guard now would
			// disarm the queue flag the dispatch just set and allow a duplicate
			// continuation. Defer the release until the dispatch settles.
			this._pendingGuardRelease = reason;
			debugLog("TodoContinuation", "Continuation guard release deferred:", reason);
			return;
		}
		const wasQueued = this.state.continuationQueued;
		this.state.continuationQueued = false;
		this.cancelGuardTimer();
		// NOTE: the in-flight flag belongs to the dispatch lifecycle. Clearing
		// it here would allow a duplicate continuation while a dispatch is
		// still on the wire.
		if (wasQueued) {
			debugLog("TodoContinuation", "Continuation guard released:", reason);
		}
	}

	/** Cancel the automatic guard-release timer */
	private cancelGuardTimer(): void {
		if (this._guardTimer) {
			clearTimeout(this._guardTimer);
			this._guardTimer = null;
		}
	}

	/** Schedule an automatic guard release (safety net for a lost settle event) */
	private scheduleGuardRelease(delayMs: number = this.guardReleaseTimeoutMs): void {
		this.cancelGuardTimer();
		this._guardTimer = setTimeout(() => {
			this._guardTimer = null;
			debugLog("TodoContinuation", "Guard auto-released after timeout");
			this.state.continuationQueued = false;
		}, delayMs);
		// Do not keep the process alive just for the guard timer
		this._guardTimer.unref?.();
	}

	/**
	 * Public method to evaluate and execute continuation
	 * Called by external handlers (e.g., agent_settled)
	 * Checks blockers and pause BEFORE selecting a task
	 */
	async decide(): Promise<ContinuationResult> {
		// A temporary pause (user input) is auto-cleared by the next decision:
		// the decision itself is the "next decision" the comment refers to.
		// A decision that runs WHILE a dispatch is in flight must not clear
		// the pause: the pending dispatch would then send a message the user
		// asked to hold back.
		if (!this.inFlight) this.state.userPaused = false;

		// The ids describe the CURRENT decision: they are set on the continue
		// paths and cleared here so a stop/blocked decision does not keep
		// reporting the last continued item.
		this.state.currentItemId = null;
		this.state.nextItemId = null;

		// 1. Check if continuation is allowed
		if (!this.canContinue()) {
			return { action: "stop", reason: "paused or session not idle" };
		}

		// 2. Check provider availability
		const availability = await this.todoProvider.availability();
		if (!availability.available) {
			debugLog("TodoContinuation", "Provider unavailable:", availability.error);
			return { action: "stop", reason: availability.error ?? "provider unavailable" };
		}

		// 3. Get todo state (throws on branch read failure)
		let inProgress: TodoItem[];
		let ready: TodoItem[];
		let blocked: TodoItem[];
		let allItems: TodoItem[];
		try {
			inProgress = await this.todoProvider.getInProgress();
			ready = await this.todoProvider.getReady();
			blocked = await this.todoProvider.getBlocked();
			const snapshot = await this.todoProvider.getSnapshot();
			allItems = snapshot.items;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			debugLog("TodoContinuation", "Failed to read todos:", msg);
			return { action: "stop", reason: `todo read failed: ${msg}` };
		}

		// 4. Filter in-progress for items without unfinished blockers
		const unblockedInProgress = inProgress.filter((item) => {
			if (!item.blockedBy?.length) return true;
			const blockerIds = new Set(item.blockedBy);
			return !allItems.some(
				(i) => blockerIds.has(i.id) && i.status !== "completed" && i.id !== item.id
			);
		});

		// 5. Continue unblocked in-progress work first
		if (unblockedInProgress.length > 0) {
			const item = unblockedInProgress[0];

			// The attempt budget is per item; switching items does not reset it
			this.state.lastItemContinued = item.id;
			this.state.steerAttemptsForCurrentItem = this.attemptsFor(item.id);

			// Check per-task attempt limit
			if (this.state.steerAttemptsForCurrentItem >= this.config.maxSteerAttempts) {
				return { action: "stop", reason: `max attempts (${this.config.maxSteerAttempts}) reached for task ${item.id}` };
			}
			// Session-wide cap: alternating between two items would never
			// exhaust the per-item budget.
			if (this._totalAttempts >= this._maxTotalSteerAttempts) {
				return { action: "stop", reason: `max total attempts (${this._maxTotalSteerAttempts}) reached` };
			}

			// A declared time budget that is spent pauses the item at a safe
			// boundary: the work stays open, the report says what is pending.
			const budget = this.budgetStatusFor(item);
			if (budget.exhausted) {
				return {
					action: "stop",
					reason: this.budgetAbortReason(item, budget),
					budget,
				};
			}

			this.state.currentItemId = item.id;
			this.state.nextItemId = item.id;
			return { action: "continue", nextItemId: item.id };
		}

		// 5. Continue ready pending work (not blocked)
		if (ready.length > 0) {
			const item = ready[0];
			
			// The attempt budget is per item; switching items does not reset it
			this.state.lastItemContinued = item.id;
			this.state.steerAttemptsForCurrentItem = this.attemptsFor(item.id);
			
			// Check per-task attempt limit
			if (this.state.steerAttemptsForCurrentItem >= this.config.maxSteerAttempts) {
				return { action: "stop", reason: `max attempts (${this.config.maxSteerAttempts}) reached for task ${item.id}` };
			}
			// Session-wide cap: alternating between two items would never
			// exhaust the per-item budget.
			if (this._totalAttempts >= this._maxTotalSteerAttempts) {
				return { action: "stop", reason: `max total attempts (${this._maxTotalSteerAttempts}) reached` };
			}

			// A declared time budget that is spent pauses the item at a safe
			// boundary: the work stays open, the report says what is pending.
			const budget = this.budgetStatusFor(item);
			if (budget.exhausted) {
				return {
					action: "stop",
					reason: this.budgetAbortReason(item, budget),
					budget,
				};
			}

			this.state.currentItemId = item.id;
			this.state.nextItemId = item.id;
			return { action: "continue", nextItemId: item.id };
		}

		// 6. Only report blocked when nothing can proceed
		if (blocked.length > 0) {
			debugLog("TodoContinuation", "Tasks blocked:", blocked.length);
			return { action: "blocked", question: `${blocked.length} task(s) blocked` };
		}

		// 7. No work remaining
		return { action: "stop", reason: "No pending tasks" };
	}

	/**
	 * Continue a specific todo item
	 *
	 * Routed through the guarded dispatch so the in-flight guard, the
	 * duplicate-queue guard and the guard-release timer behave exactly like
	 * they do for an automatic continuation. A blocked or failed dispatch
	 * never consumes the attempt budget.
	 */
	async continueItem(item: TodoItem): Promise<void> {
		// The attempt budget is per item; switching items does not reset it
		this.state.lastItemContinued = item.id;
		this.state.steerAttemptsForCurrentItem = this.attemptsFor(item.id);

		if (this.state.steerAttemptsForCurrentItem >= this.config.maxSteerAttempts) {
			debugLog("TodoContinuation", "Max steer attempts reached for item", item.id);
			return;
		}
		if (this._totalAttempts >= this._maxTotalSteerAttempts) {
			debugLog("TodoContinuation", "Max total steer attempts reached");
			return;
		}

		// The message is built when the dispatch is about to be sent: the
		// validation context must reflect the state at that moment.
		this.markItemStarted(item.id);

		debugLog("TodoContinuation", "Sending continuation:", item.subject);

		const result = await this.guardedDispatch(item.id, (dispatched) => {
			const target = dispatched ?? item;
			const baseMessage = target.description
				? `Continue task: ${target.subject}\n\n${target.description}`
				: `Continue task: ${target.subject}`;
			// A retry after a stalled dispatch gets the same duplicate warning
			// as the automatic continuation path.
			const retryNote =
				this._stalledItemId === item.id
					? " (retry after a stalled dispatch - a duplicate continuation for this item may still arrive)"
					: "";
			// A spent time budget pauses the item: nothing goes on the wire.
			const budget = this.budgetStatusFor(target);
			if (budget.exhausted) {
				return { abort: this.budgetAbortReason(target, budget) };
			}
			// A declared staged-validation plan rides along with the
			// continuation: the agent must know which tier is cheap before it
			// picks a command.
			const validation = buildValidationSteerSuffix(target, {
				elapsedMs: this.elapsedForItem(target.id),
				state: this.validationStateFor(target),
			});
			return {
				send: validation
					? `${baseMessage}${retryNote}\n\n${validation}`
					: `${baseMessage}${retryNote}`,
			};
		});
		if (result.dispatched) {
			// Only a dispatch that actually reached the agent consumes an attempt
			this.recordAttempt(item.id);
			if (this._stalledItemId === item.id) this._stalledItemId = null;
		} else {
			debugLog("TodoContinuation", "Continuation not dispatched:", result.reason);
		}
	}

	/**
	 * Record a successful dispatch against the per-item and session budgets.
	 */
	private recordAttempt(itemId: number): void {
		const attempts = this.attemptsFor(itemId) + 1;
		this._attemptsByItem.set(itemId, attempts);
		this._totalAttempts++;
		this.state.steerAttemptsForCurrentItem = attempts;
	}

	/**
	 * Guarded dispatch - checks all conditions before sending
	 * Uses in-flight guard to prevent race conditions
	 *
	 * The message is built by `buildMessage` at the moment the dispatch is
	 * about to send, so the payload always reflects the state at that moment
	 * (and the item comes from the snapshot read this dispatch already does).
	 */
	private async guardedDispatch(
		itemId: number,
		buildMessage: (item: TodoItem | undefined) => DispatchPayload,
	): Promise<GuardedDispatchResult> {
		// 0. A disposed controller never dispatches.
		if (this._disposed) {
			debugLog("TodoContinuation", "Guarded dispatch: controller disposed, skipping");
			this._blockedDispatches++;
			return { dispatched: false, reason: "controller disposed", blocked: true };
		}

		// 1. Acquire in-flight guard to prevent concurrent dispatches
		if (this.inFlight) {
			debugLog("TodoContinuation", "Guarded dispatch: already in-flight, skipping");
			this._blockedDispatches++;
			return { dispatched: false, reason: "dispatch already in flight", blocked: true };
		}

		// 2. Check if paused by explicit user pause
		if (this.state.explicitPause) {
			debugLog("TodoContinuation", "Guarded dispatch: explicitly paused, skipping");
			this._blockedDispatches++;
			return { dispatched: false, reason: "explicitly paused", blocked: true };
		}

		// 3. A user message that is still being processed pauses the
		//    continuation. tempPause() is auto-cleared on the next decision.
		if (this.state.userPaused) {
			debugLog("TodoContinuation", "Guarded dispatch: user input pending, skipping");
			this._blockedDispatches++;
			return { dispatched: false, reason: "user input pending", blocked: true };
		}

		// 4. The circuit breaker: a permanently broken transport must not be
		//    retried on every settle. After the cooldown a trial is allowed.
		if (this.breakerOpen()) {
			debugLog("TodoContinuation", "Guarded dispatch: circuit breaker open, skipping");
			this._blockedDispatches++;
			return {
				dispatched: false,
				reason: `circuit breaker open after ${this._consecutiveFailures} consecutive failures`,
				blocked: true,
			};
		}

		// 5. Check if session is still idle
		if (this.ctx.isIdle?.() === false) {
			debugLog("TodoContinuation", "Guarded dispatch: session not idle, skipping");
			this._blockedDispatches++;
			return { dispatched: false, reason: "session not idle", blocked: true };
		}

		// 6. Check if continuation already queued (prevent duplicates)
		if (this.state.continuationQueued) {
			debugLog("TodoContinuation", "Guarded dispatch: already queued, skipping");
			this._blockedDispatches++;
			return { dispatched: false, reason: "continuation already queued", blocked: true };
		}

		// The in-flight guard is held for the WHOLE dispatch (including the
		// send): it must only be released once the dispatch has settled.
		// The sequence number identifies THIS dispatch: a stale dispatch (one
		// whose watchdog already fired) must never clear the flag of a newer
		// dispatch and must never send after it was superseded.
		const seq = ++this._dispatchSeq;
		this._inFlightSeq = seq;
		let watchdog: ReturnType<typeof setTimeout> | null = null;

		// The watchdog is armed IMMEDIATELY: a hanging todo read must not keep
		// the guard forever. The timer belongs to THIS dispatch only.
		watchdog = setTimeout(() => {
			if (this._inFlightSeq !== seq) return;  // A newer dispatch owns the guard
			debugLog(
				"TodoContinuation",
				`In-flight dispatch still pending after ${this._inFlightTimeoutMs}ms - forcing release`,
			);
			this._inFlightSeq = null;
			// A hung dispatch is treated like a failed one: the guard is
			// released so the next decision can try again.
			// NOTE: the flag is read BEFORE it is cleared: it tells us whether
			// the send had already started (a message may still land).
			const hadStartedSending = this.state.continuationQueued;
			this.state.continuationQueued = false;
			this.cancelGuardTimer();
			// A cancel intent that was raised while this dispatch hung belongs to
			// THIS dispatch. It must not survive: otherwise it would cancel the
			// next legitimate dispatch and silently lose a continuation cycle.
			this._cancelRequested = false;
			// Remember the item: a later dispatch for the same item is a RETRY
			// of a message that may still land. The message says so.
			// Only when the send had already started - a hang in the todo read
			// never put a message on the wire, so there is no duplicate to warn
			// about.
			if (hadStartedSending) this._stalledItemId = itemId;
		}, this._inFlightTimeoutMs);
		if (typeof watchdog.unref === "function") watchdog.unref();
		try {
			// 7. Verify item still needs work (not completed)
			let item: TodoItem | undefined;
			try {
				const snapshot = await this.todoProvider.getSnapshot();
				item = snapshot.items.find((i) => i.id === itemId);
			} catch {
				// If we can't read todos, skip dispatch
				debugLog("TodoContinuation", "Guarded dispatch: failed to read todos, skipping");
				this._blockedDispatches++;
				return { dispatched: false, reason: "todo read failed", blocked: true };
			}
			if (item?.status === "completed") {
				debugLog("TodoContinuation", "Guarded dispatch: item completed, skipping");
				this._blockedDispatches++;
				return { dispatched: false, reason: "item already completed", blocked: true };
			}

			// 8. The snapshot read above is asynchronous: the queue may have
			//    been cleared, a pause requested or the dispatch superseded in
			//    the meantime. In that case the message must NOT be sent.
			//
			//    The superseded check comes FIRST: a stale dispatch must not
			//    consume the cancel intent of the dispatch that replaced it.
			if (this._inFlightSeq !== seq) {
				// The watchdog already released this dispatch and a newer one
				// took over. Sending now would put two messages on the wire.
				debugLog("TodoContinuation", "Guarded dispatch: superseded, skipping");
				this._blockedDispatches++;
				return { dispatched: false, reason: "dispatch superseded", blocked: true };
			}
			if (this.state.explicitPause || this.state.userPaused) {
				// The pause is more specific than the generic cancel flag: a
				// pause that arrived during the snapshot read is reported as a
				// pause. The cancel intent is consumed here as well so a later
				// dispatch is not cancelled by a stale flag.
				this._cancelRequested = false;
				debugLog("TodoContinuation", "Guarded dispatch: paused before send, skipping");
				this._blockedDispatches++;
				return { dispatched: false, reason: "paused before send", blocked: true };
			}
			if (this._cancelRequested) {
				this._cancelRequested = false;
				debugLog("TodoContinuation", "Guarded dispatch: cancelled before send, skipping");
				this._blockedDispatches++;
				return { dispatched: false, reason: "cancelled before send", blocked: true };
			}

			// All checks passed - dispatch
			this.state.continuationQueued = true;

			// Arm the guard-release timer BEFORE the send: a dispatch that hangs
			// must not leave the guard armed forever.
			this.scheduleGuardRelease();

			try {
				const payload = buildMessage(item);
				if ("abort" in payload) {
					// The message builder refused the dispatch (e.g. the item
					// ran out of its declared time budget). Nothing goes on the
					// wire, and the guard is released again.
					debugLog("TodoContinuation", "Guarded dispatch: aborted before send:", payload.abort);
					this.state.continuationQueued = false;
					this.cancelGuardTimer();
					this._blockedDispatches++;
					return { dispatched: false, reason: payload.abort, blocked: true };
				}
				const message = payload.send;
				await this.config.dispatch(message);
				this.state.lastSteerMessage = message;
				// Only the dispatch that owns the guard may reset the
				// breaker: a stale success must not close a breaker that is
				// legitimately open for the current dispatch.
				if (this._inFlightSeq === seq) this._consecutiveFailures = 0;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				debugLog("TodoContinuation", "Guarded dispatch failed:", msg);
				// Only the dispatch that still owns the guard may disarm it: a
				// stale failure must not clear the guard of a newer dispatch.
				if (this._inFlightSeq === seq) {
					this.state.continuationQueued = false;
					this.cancelGuardTimer();
					// The breaker counters belong to the dispatch that owns the
					// guard: a stale failure must not trip the breaker for the
					// current dispatch.
					this._consecutiveFailures++;
					this._lastFailureAt = Date.now();
				}
				// A failed send is NOT a guard block: report the real reason so
				// the caller can see what actually went wrong.
				const reason = `dispatch failed: ${msg}`;
				if (this._consecutiveFailures >= this._maxConsecutiveFailures) {
					// Circuit breaker: a permanently broken transport must not be
					// retried on every settle with no budget at all.
					return {
						dispatched: false,
						reason: `${reason} (circuit breaker open after ${this._consecutiveFailures} consecutive failures)`,
						blocked: false,
					};
				}
				return { dispatched: false, reason, blocked: false };
			}

			// Queue stays set while the agent processes the continuation.
			// It is released by releaseContinuationGuard() when the turn settles.
			// (The release timer was already armed before the send.)
			return { dispatched: true, blocked: false };
		} finally {
			// Is this dispatch still the one that owns the guard?
			const isCurrent = this._inFlightSeq === seq;
			if (watchdog) {
				clearTimeout(watchdog);
				watchdog = null;
			}
			// Only THIS dispatch may release the in-flight guard.
			if (isCurrent) {
				this._inFlightSeq = null;
				// A clearQueue() during the dispatch cancels it: the guard must not
				// be re-armed for a continuation nobody is waiting for.
				if (this._cancelRequested) {
					this._cancelRequested = false;
					this.state.continuationQueued = false;
					this.cancelGuardTimer();
				}
				// A guard release that arrived while the dispatch was on the wire is
				// DROPPED: such a release belongs to the turn that was already
				// running, not to the dispatch that is settling now. Applying it
				// would disarm the guard of the dispatch that just completed.
				// The next settle releases the guard instead.
				if (this._pendingGuardRelease !== null) {
					debugLog(
						"TodoContinuation",
						"Continuation guard release dropped (arrived mid-dispatch):",
						this._pendingGuardRelease,
					);
					this._lastDroppedGuardRelease = this._pendingGuardRelease;
					this._pendingGuardRelease = null;
					// The guard stays armed (the dispatch DID send), so it must not
					// block the next continuation until the full safety-net
					// timeout. Release it shortly after the dispatch settled.
					this.scheduleGuardRelease(this.guardReleaseAfterDropMs);
				}
			}
		}
	}

	/**
	 * Steer to continue a todo item
	 *
	 * The attempt budget is only consumed by dispatches that actually reached
	 * the agent. Dispatches blocked by a guard are counted separately so a
	 * blocked attempt can never exhaust the retry budget.
	 */
	async steerToContinue(itemId: number): Promise<SteerResult> {
		// The attempt budget is per item; switching items does not reset it
		this.state.lastItemContinued = itemId;
		this.state.steerAttemptsForCurrentItem = this.attemptsFor(itemId);

		if (this.state.steerAttemptsForCurrentItem >= this.config.maxSteerAttempts) {
			debugLog("TodoContinuation", "Max steer attempts reached for item", itemId);
			return {
				dispatched: false,
				reason: `max attempts (${this.config.maxSteerAttempts}) reached for task ${itemId}`,
				attempts: this.state.steerAttemptsForCurrentItem,
				blockedDispatches: this._blockedDispatches,
			};
		}
		if (this._totalAttempts >= this._maxTotalSteerAttempts) {
			return {
				dispatched: false,
				reason: `max total attempts (${this._maxTotalSteerAttempts}) reached`,
				attempts: this.state.steerAttemptsForCurrentItem,
				blockedDispatches: this._blockedDispatches,
			};
		}

		this.markItemStarted(itemId);
		debugLog("TodoContinuation", "Attempting steer to continue item", itemId);

		// The message is built when the dispatch is about to be sent, from the
		// item the dispatch itself read: one snapshot read, no extra latency,
		// and the validation context is always current.
		const result = await this.guardedDispatch(itemId, (item) => {
			const baseMessage =
				this._stalledItemId === itemId
					? `Continue todo item ID ${itemId}. (retry after a stalled dispatch - a duplicate continuation for this item may still arrive)`
					: `Continue todo item ID ${itemId}.`;
			// A spent time budget pauses the item: nothing goes on the wire.
			const budget = this.budgetStatusFor(item);
			if (budget.exhausted && item) {
				return { abort: this.budgetAbortReason(item, budget) };
			}
			// A declared staged-validation plan rides along with the
			// continuation: the agent must know which tier is cheap before it
			// picks a command.
			const validation = buildValidationSteerSuffix(item, {
				elapsedMs: this.elapsedForItem(itemId),
				state: this.validationStateFor(item),
			});
			return { send: validation ? `${baseMessage}\n\n${validation}` : baseMessage };
		});
		if (result.dispatched) {
			// Only a dispatch that actually reached the agent consumes an attempt
			this.recordAttempt(itemId);
			if (this._stalledItemId === itemId) this._stalledItemId = null;
			return {
				dispatched: true,
				attempts: this.state.steerAttemptsForCurrentItem,
				blockedDispatches: this._blockedDispatches,
			};
		}

		debugLog("TodoContinuation", "Steer not dispatched:", result.reason);
		return {
			dispatched: false,
			reason: result.reason,
			attempts: this.state.steerAttemptsForCurrentItem,
			blockedDispatches: this._blockedDispatches,
		};
	}

	/**
	 * Mark a todo item as complete
	 */
	async markComplete(_itemId: number): Promise<void> {
		debugLog("TodoContinuation", "Marking item complete");
		this.state.currentItemId = null;
		this.state.generation++;
	}

	/**
	 * User paused
	 */
	pause(): void {
		debugLog("TodoContinuation", "User paused");
		this.state.userPaused = true;
		// A user pause stops automatic continuations until resume() is called.
		this.state.explicitPause = true;
		this.state.continuationQueued = false;
		this._pendingGuardRelease = null;
		if (this.inFlight) this._cancelRequested = true;
		this.cancelGuardTimer();
	}

	/**
	 * Reset state for new session
	 */
	_reset(): void {
		this.cancelGuardTimer();
		this._blockedDispatches = 0;
		this._consecutiveFailures = 0;
		this._lastFailureAt = 0;
		this._pendingGuardRelease = null;
		this._lastDroppedGuardRelease = null;
		this._stalledItemId = null;
		this._cancelRequested = false;
		this._attemptsByItem.clear();
		this._totalAttempts = 0;
		this.state = {
			sessionId: `session-${Date.now()}`,
			generation: 0,
			todoRevision: 0,
			currentItemId: null,
			nextItemId: null,
			lastMessageId: null,
			continuationQueued: false,
			userPaused: false,
			explicitPause: false,
			lastSteerMessage: null,
			steerAttemptsForCurrentItem: 0,
			lastItemContinued: null,
			lastEvaluationResult: null,
		};
		// A fresh session starts with a clean in-flight guard. A dispatch that
		// hung in the previous session is released by its own watchdog, and
		// that watchdog can no longer touch the new session's guard because
		// the sequence numbers differ.
		this._inFlightSeq = null;
	}

	/**
	 * Cleanup on shutdown
	 */
	_cleanup(): void {
		debugLog("TodoContinuation", "Cleaning up");
		this.cancelGuardTimer();
		this.state.continuationQueued = false;
		this._pendingGuardRelease = null;
		this.state.generation++;
	}

	/**
	 * Public shutdown hook (used by the host on session shutdown).
	 *
	 * Releases the guard timer and the queue so a stopped session never keeps
	 * a timer alive or blocks a later continuation.
	 */
	dispose(): void {
		this._disposed = true;
		this._cleanup();
		// The in-flight guard is released as well: a dispatch that is still on
		// the wire must not keep the session's guard busy. The sequence check
		// in the dispatch's finally block keeps it from clearing the flag of a
		// later dispatch.
		this._inFlightSeq = null;
		// A cancel intent that is left over from a cancelled dispatch must not
		// disarm the guard of a later one.
		this._cancelRequested = false;
		this._stalledItemId = null;
	}

	/**
	 * Get current state summary
	 *
	 * The item ids are reported as ids - the full TodoItem is only available
	 * from the (asynchronous) provider snapshot, so no partial object is
	 * presented as a TodoItem.
	 */
	getState(): { current: { id: number } | null; next: { id: number } | null } {
		return {
			current: this.state.currentItemId != null ? { id: this.state.currentItemId } : null,
			next: this.state.nextItemId != null ? { id: this.state.nextItemId } : null,
		};
	}

	/**
	 * Full controller state (for diagnostics and tests)
	 */
	getDiagnostics(): {
		continuationQueued: boolean;
		inFlight: boolean;
		steerAttemptsForCurrentItem: number;
		blockedDispatches: number;
		consecutiveFailures: number;
		circuitBreakerOpen: boolean;
		totalAttempts: number;
		lastItemContinued: number | null;
		lastSteerMessage: string | null;
		explicitPause: boolean;
		userPaused: boolean;
		pendingGuardRelease: string | null;
		lastDroppedGuardRelease: string | null;
		cancelRequested: boolean;
		disposed: boolean;
	} {
		return {
			continuationQueued: this.state.continuationQueued,
			inFlight: this.inFlight,
			steerAttemptsForCurrentItem: this.state.steerAttemptsForCurrentItem,
			blockedDispatches: this._blockedDispatches,
			consecutiveFailures: this._consecutiveFailures,
			circuitBreakerOpen: this.breakerOpen(),
			totalAttempts: this._totalAttempts,
			lastItemContinued: this.state.lastItemContinued,
			lastSteerMessage: this.state.lastSteerMessage,
			explicitPause: this.state.explicitPause,
			userPaused: this.state.userPaused,
			pendingGuardRelease: this._pendingGuardRelease,
			lastDroppedGuardRelease: this._lastDroppedGuardRelease,
			cancelRequested: this._cancelRequested,
			disposed: this._disposed,
		};
	}
}

/**
 * Create a todo continuation controller
 * Note: Caller is responsible for registering event handlers with the proper context
 */
export function createTodoContinuation(
	ctx: TodoContext,
	config?: ContinuationConfig
): TodoContinuationController {
	return new TodoContinuationController(ctx, config);
}
