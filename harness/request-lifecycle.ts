/**
 * The lifecycle of one request of the human.
 *
 * A request is a unit of work: it has an identity (the generation of the
 * request scope), a state (what is still open) and an end. Every producer
 * of a continuation - the natural stop of the agent, the recovery of a
 * provider, the guard of a repeated output - asks this module what the
 * request looks like, so the producers cannot disagree with each other.
 *
 * The rules the module keeps:
 *
 * - The work of the request is read from the authoritative list of the
 *   todos of the request, not from the wording of the assistant. A list
 *   that cannot be read is unknown, and an unknown state is never a
 *   completion.
 * - A request that is done ends once. The end is a terminal transition:
 *   the continuations of that request are cancelled, and no producer can
 *   start a new one.
 * - A continuation is sent once for a state of the work. The same open work
 *   does not produce a second continuation, so a request cannot spin.
 * - A request of the human that replaces another one is a new request. The
 *   cleanup of the old one never touches the new one.
 */

/** The state of the work of the request. */
export type RequestWorkState = "unfinished" | "complete" | "unknown" | "pending";

/** The todo of the request, as the lifecycle sees it. */
export interface LifecycleTodo {
	id?: number | string;
	subject?: string;
	status?: string;
	metadata?: Record<string, unknown> | null;
}

/** A snapshot of the work of the request. */
export interface RequestWorkSnapshot {
	/** Is the list of the todos readable at all? */
	available: boolean;
	/** The todos of the session (the whole list). */
	items: readonly LifecycleTodo[] | null;
	/**
	 * The todos that belong to the request that is running.
	 *
	 * Without it the whole list belongs to the request: the harness reads
	 * the list this way when it cannot tell the requests apart.
	 */
	ownItems?: readonly LifecycleTodo[] | null;
	/**
	 * Is a required validation still pending for this item?
	 *
	 * An item that is marked complete while its final tier has not passed
	 * is not done: the validation is work that remains.
	 */
	validationPending?: (item: LifecycleTodo) => boolean;
	/**
	 * Is the ledger of the validation readable?
	 *
	 * "unknown" is the honest answer when the ledger is absent or cannot
	 * be read: the ledger is the source of the truth about the final tier,
	 * and a state that cannot be read is never a completion.
	 */
	validationAvailability?: "available" | "unknown";
	/**
	 * Is the review work of the request still to come?
	 *
	 * A request whose implementation todos are done but whose review has
	 * not been materialized yet is not done: the review is work that
	 * remains, and the harness owns it.
	 */
	reviewPending?: boolean;
	/**
	 * The issues of the backlog that the request authorizes.
	 *
	 * An authorized issue is work of the request: it belongs to its todos
	 * and it is continued there. An issue that nobody authorized is a
	 * candidate and never work.
	 */
	authorizedIssues?: readonly string[];
	/**
	 * The authorized issues that are still outstanding.
	 *
	 * The work was authorized, so it remains work until it is done: a
	 * request whose authorized issue is still open is not finished.
	 */
	authorizedOutstanding?: readonly string[];
	/**
	 * Is the state of the authorized issues readable?
	 *
	 * "unknown" is the honest answer when the backlog cannot be read: the
	 * authorized work is then unknown, and an unknown work is not a
	 * finished work.
	 */
	authorizedAvailability?: "available" | "unknown";
	/** Why the list is not readable. */
	reason?: string;
}

/** What the lifecycle knows about the work of the request. */
export interface RequestWorkView {
	/** The state of the work. */
	work: RequestWorkState;
	/** The open todos of the request: the work that remains. */
	open: readonly LifecycleTodo[];
	/**
	 * The open todos that do not belong to the request.
	 *
	 * They are candidates, not work: the request does not wait for them and
	 * it does not execute them either.
	 */
	deferred: readonly LifecycleTodo[];
	/** Is the list readable? */
	available: boolean;
	/** Why the state is what it is. */
	reason: string;
}

/**
 * Is this todo open?
 *
 * A deleted todo is not open, and a completed one is not open. Every other
 * status is work that remains: the status of a todo that the provider does
 * not know (a blocked item, for example) is open, because an unknown status
 * is not a finished item.
 */
export function isOpenLifecycleTodo(todo: LifecycleTodo): boolean {
	const status = (todo.status ?? "").trim().toLowerCase();
	if (status === "deleted" || status === "completed" || status === "done") {
		return false;
	}
	return true;
}

/** The identity of an item, for the comparison of two lists. */
function itemKey(item: LifecycleTodo): string {
	if (item.id === undefined || item.id === null) {
		return `subject:${(item.subject ?? "").trim()}`;
	}
	return `id:${item.id}`;
}

/**
 * The state of the required validation of the request.
 *
 * - "none": nothing of the request waits for a validation,
 * - "pending": a required validation has not passed,
 * - "unknown": the ledger could not be read, and a state that cannot be
 *   read is never a completion.
 */
function validationStateOf(
	snapshot: RequestWorkSnapshot,
	own: readonly LifecycleTodo[],
): "none" | "pending" | "unknown" {
	if (snapshot.validationAvailability === "unknown") return "unknown";
	const reader = snapshot.validationPending;
	if (!reader) return "none";
	for (const item of own) {
		let pending = false;
		try {
			pending = Boolean(reader(item));
		} catch {
			// The ledger could not be read: the state of the validation is
			// unknown, and an unknown validation is not a passed validation.
			return "unknown";
		}
		if (pending) return "pending";
	}
	return "none";
}

/**
 * The work of the request that comes from the issues of the backlog.
 *
 * - "none": the request authorized nothing, or everything it authorized is
 *   done,
 * - "unfinished": an authorized issue is still open,
 * - "unknown": the backlog could not be read, so the authorized work is
 *   unknown and an unknown work is not a finished work.
 */
function authorizedWorkOf(
	snapshot: RequestWorkSnapshot,
): { action: "none" | "unfinished" | "unknown"; reason: string } {
	const authorized = snapshot.authorizedIssues ?? [];
	if (authorized.length === 0) return { action: "none", reason: "" };
	if (snapshot.authorizedAvailability === "unknown") {
		return {
			action: "unknown",
			reason: "the state of the authorized issues of the request could not be read",
		};
	}
	const outstanding = snapshot.authorizedOutstanding ?? [];
	if (outstanding.length === 0) {
		return { action: "none", reason: "" };
	}
	return {
		action: "unfinished",
		reason: `${outstanding.length} authorized issue(s) of the request are still open`,
	};
}

/**
 * The work of the request, from a snapshot of the list.
 *
 * The scope of the request delimits the work: a todo of an earlier request
 * is history, and its being open does not keep the request of the human
 * awake. It is reported as deferred, so the request can propose it, and
 * it is never executed as work of the request.
 */
export function readRequestWork(
	snapshot: RequestWorkSnapshot | null | undefined,
): RequestWorkView {
	if (!snapshot || snapshot.available === false || !snapshot.items) {
		return {
			work: "unknown",
			open: [],
			deferred: [],
			available: false,
			reason: snapshot?.reason ?? "the task list could not be read",
		};
	}
	const relevant = snapshot.items.filter(
		(item) => (item.status ?? "").trim().toLowerCase() !== "deleted",
	);
	const own = snapshot.ownItems ?? relevant;
	const ownKeys = new Set(own.map(itemKey));
	const open = relevant.filter(isOpenLifecycleTodo);
	const openOwn = open.filter((item) => ownKeys.has(itemKey(item)));
	const deferred = open.filter((item) => !ownKeys.has(itemKey(item)));

	if (openOwn.length > 0) {
		return {
			work: "unfinished",
			open: openOwn,
			deferred,
			available: true,
			reason: `${openOwn.length} todo(s) of the request are still open`,
		};
	}
	const authorized = authorizedWorkOf(snapshot);
	if (authorized.action === "unknown") {
		// The backlog could not be read: the authorized work of the request
		// is unknown, and an unknown work is not a finished work.
		return {
			work: "unknown",
			open: [],
			deferred,
			available: true,
			reason: authorized.reason,
		};
	}
	if (authorized.action === "unfinished") {
		return {
			work: "unfinished",
			open: [],
			deferred,
			available: true,
			reason: authorized.reason,
		};
	}
	const validation = validationStateOf(snapshot, own);
	if (validation === "pending") {
		return {
			work: "unfinished",
			open: [],
			deferred,
			available: true,
			reason: "a required validation of the request has not passed",
		};
	}
	if (validation === "unknown") {
		// The ledger of the validation could not be read. The request is
		// not complete: a validation that cannot be read has not passed.
		return {
			work: "unknown",
			open: [],
			deferred,
			available: true,
			reason: "the state of the required validation could not be read",
		};
	}
	if (snapshot.reviewPending === true) {
		// The implementation of the request is done, but the review work
		// is not materialized yet: the request waits for the harness, and
		// the agent is not sent a continuation it cannot act on.
		return {
			work: "pending",
			open: [],
			deferred,
			available: true,
			reason:
				"the review work of the request is still to come: the implementation todos are done",
		};
	}
	if (own.length === 0) {
		// There is no work of the request in the list. That is not a proof
		// that the request is finished: the work of a request may never have
		// been recorded.
		return {
			work: "unknown",
			open: [],
			deferred,
			available: true,
			reason: "the task list holds no todo of the request",
		};
	}
	return {
		work: "complete",
		open: [],
		deferred,
		available: true,
		reason: `every todo of the request is done (${own.length} item(s))`,
	};
}

/** What the lifecycle does when the agent stops. */
export type ContinuationAction = "continue" | "idle" | "unverified" | "wait";

/** The decision of the lifecycle. */
export interface ContinuationDecision {
	/** The action. */
	action: ContinuationAction;
	/** Why, in words. */
	reason: string;
	/** The instruction for the agent, when the action continues the work. */
	instruction?: string;
	/** The state of the work the decision was taken on. */
	work: RequestWorkState;
	/**
	 * The open items of the request: the candidates of the continuation.
	 *
	 * The candidates are the work the request may continue. The dispatch
	 * selects the eligible ones of them, so the continuation names an item
	 * that may run and not every pending item of the list.
	 */
	candidates?: readonly LifecycleTodo[];
}

/** The options of the decision. */
export interface ContinuationOptions {
	/**
	 * How many bounded recoveries the request already had.
	 *
	 * A state that cannot be read is recovered a bounded number of times:
	 * the harness does not declare a completion it cannot prove, and it
	 * does not spin either.
	 */
	recoveries?: number;
	/** How many bounded recoveries a request may have. */
	maxRecoveries?: number;
}

/** The default number of bounded recoveries of a request. */
export const DEFAULT_MAX_RECOVERIES = 1;

/**
 * The default number of continuations for the same work.
 *
 * The bound is the visible reason of a stall: three continuations for a
 * work that does not move are enough to know that the continuation does
 * not help.
 */
export const DEFAULT_MAX_CONTINUATIONS = 3;

/**
 * The instruction that continues the work of the request.
 *
 * It names the open work, so the agent continues the work of the request
 * instead of looking for other work.
 */
export function buildContinuationInstruction(
	view: RequestWorkView,
): string {
	const subjects = view.open
		.map((item) => (item.subject ?? "").trim())
		.filter((subject) => subject.length > 0);
	const lines = [
		"[harness:request-work] The request of the user is not finished.",
		"The task list of this request still holds open work:",
		...subjects.map((subject) => `- ${subject}`),
		"Continue with the next open item of this request.",
		"Do not start, resume or expand any other work, and do not look for other tasks.",
	];
	return lines.join("\n");
}

/**
 * The decision of the lifecycle, from the state of the work.
 *
 * - Work remains: the request continues, exactly once for that work.
 * - The work is done: the request ends, and the session stays idle.
 * - The state is unknown: the request is recovered a bounded number of
 *   times, and then the session waits for the human.
 */
export function decideContinuation(
	view: RequestWorkView,
	options: ContinuationOptions = {},
): ContinuationDecision {
	const maxRecoveries = options.maxRecoveries ?? DEFAULT_MAX_RECOVERIES;
	const recoveries = options.recoveries ?? 0;
	if (view.work === "unfinished") {
		return {
			action: "continue",
			reason: view.reason,
			instruction: buildContinuationInstruction(view),
			work: view.work,
			candidates: view.open,
		};
	}
	if (view.work === "complete") {
		return {
			action: "idle",
			reason: view.reason,
			work: view.work,
		};
	}
	if (view.work === "pending") {
		// The work of the request is not done, but it is not the work of
		// the agent either: the harness owns the next step, so the request
		// waits instead of being continued.
		return {
			action: "wait",
			reason: view.reason,
			work: view.work,
		};
	}
	if (recoveries >= maxRecoveries) {
		return {
			action: "unverified",
			reason: `the state of the work is unknown (${view.reason}); the bounded recovery of the request is used up`,
			work: view.work,
		};
	}
	return {
		action: "continue",
		reason: `the state of the work is unknown (${view.reason}); the request is recovered once`,
		instruction: [
			"[harness:request-work] The state of the work of this request could not be read.",
			"Read the task list of this request (todo list) and continue the open work of this request.",
			"If the work of the request is done, say so and stop.",
			"Do not start, resume or expand any other work, and do not look for other tasks.",
		].join("\n"),
		work: view.work,
	};
}

/** The options of the controller of the lifecycle. */
export interface RequestLifecycleOptions {
	/** Reads the work of the request that is running. */
	readSnapshot: () => Promise<RequestWorkSnapshot | null | undefined>;
	/**
	 * Sends the continuation to the agent.
	 *
	 * The dispatch is the boundary of the request: it rechecks the
	 * terminal state and the generation of the request before it sends
	 * anything. A dispatch that reports a failure (false) means that the
	 * message did not reach the agent, and the work stays continuable.
	 */
	dispatch?: (
		instruction: string,
		decision: ContinuationDecision,
	) => Promise<void | boolean> | void | boolean;
	/**
	 * Cancels the continuations that the request owns.
	 *
	 * The harness owns its timers and its queued messages; the terminal
	 * transition gives them back.
	 */
	cancel?: (generation: number) => void;
	/** The number of the request that is running. */
	generation?: () => number;
	/**
	 * How many times the request may continue for the same work without
	 * progress.
	 */
	maxContinuations?: number;
	/** How many bounded recoveries a request may have. */
	maxRecoveries?: number;
}

/** The state of one request. */
interface RequestLifecycleState {
	generation: number;
	terminal: boolean;
	terminalReason?: string;
	recoveries: number;
	/** The work the request continued for. */
	continuedFor: string;
	/** How many times the request continued for the same work. */
	continuations: number;
	/** Is the continuation of the request still queued? */
	outstanding: boolean;
}

/**
 * The controller of the lifecycle of the requests.
 *
 * The controller is the single place that knows whether the request that
 * is running is finished. Every producer of a continuation asks it, so no
 * producer can start a turn for a request that is done.
 */
export class RequestLifecycleController {
	private readonly options: RequestLifecycleOptions;
	private state: RequestLifecycleState;

	constructor(options: RequestLifecycleOptions) {
		this.options = options;
		this.state = {
			generation: options.generation?.() ?? 0,
			terminal: false,
			recoveries: 0,
			continuedFor: "",
			continuations: 0,
			outstanding: false,
		};
	}

	/** The number of the request that is running. */
	get generation(): number {
		return this.options.generation?.() ?? this.state.generation;
	}

	/**
	 * How many times the request may continue for the same work.
	 */
	private get maxContinuations(): number {
		return this.options.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS;
	}

	/** Is the request that is running finished? */
	get terminal(): boolean {
		return this.state.terminal;
	}

	/** Why the request ended, when it ended. */
	get terminalReason(): string | undefined {
		return this.state.terminalReason;
	}

	/**
	 * A request of the human begins.
	 *
	 * The state of the previous request is not carried over: it was the
	 * state of another request.
	 */
	beginRequest(generation?: number): void {
		this.state = {
			generation: generation ?? this.generation,
			terminal: false,
			recoveries: 0,
			continuedFor: "",
			continuations: 0,
			outstanding: false,
		};
	}

	/**
	 * The request ends.
	 *
	 * The end is a transition, not a flag: it happens once per request, it
	 * gives the continuations of the request back, and it stops the
	 * producers that would start a new one.
	 */
	markTerminal(reason: string): boolean {
		if (this.state.terminal) return false;
		this.state.terminal = true;
		this.state.terminalReason = reason;
		try {
			this.options.cancel?.(this.state.generation);
		} catch {
			// The cleanup is a convenience: a failure of it must not keep
			// the request open, and it must not throw into the run.
		}
		return true;
	}

	/**
	 * Read the work of the request, without deciding anything.
	 *
	 * The guard of a late continuation needs the state of the work, not a
	 * continuation of its own.
	 */
	async readView(): Promise<RequestWorkView> {
		const state = this.state;
		let snapshot: RequestWorkSnapshot | null | undefined = null;
		try {
			snapshot = await this.options.readSnapshot();
		} catch {
			snapshot = null;
		}
		if (this.isStale(state)) {
			// The read belongs to a request that is not the one that is
			// running: its state is not the state of this request, and an
			// unknown state is never a completion.
			return {
				work: "unknown",
				open: [],
				deferred: [],
				available: false,
				reason: "the request was replaced while its state was read",
			};
		}
		return readRequestWork(snapshot);
	}

	/**
	 * Is a read of the work stale?
	 *
	 * The read of the work is asynchronous: the request of the human can
	 * replace the running one while the read is running. The result of
	 * such a read belongs to the request it was taken for, and it is never
	 * applied to the request that is running now.
	 */
	private isStale(state: RequestLifecycleState): boolean {
		return this.state !== state || this.generation !== state.generation;
	}

	/**
	 * Read the work of the request and decide what happens next.
	 *
	 * The decision is taken on the state of the work, never on the wording
	 * of the assistant.
	 */
	async settle(): Promise<ContinuationDecision> {
		// The state is captured before the read: the read is asynchronous
		// and the request of the human may replace the running one while
		// it runs. Every mutation below belongs to the captured state, and
		// a read of another request is rejected before it can mutate
		// anything.
		const state = this.state;
		if (state.terminal) {
			return {
				action: "idle",
				reason: state.terminalReason ?? "the request is finished",
				work: "complete",
			};
		}
		const snapshot = await this.readWork();
		if (this.isStale(state)) {
			return {
				action: "idle",
				reason: "the request was replaced while its state was read",
				work: "unknown",
			};
		}
		return this.decide(state, snapshot);
	}

	/**
	 * The read of the work, without a decision.
	 *
	 * A read that fails is an unknown state, never a completion.
	 */
	private async readWork(): Promise<RequestWorkSnapshot | null> {
		try {
			return (await this.options.readSnapshot()) ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * The decision of the request, on a read that belongs to it.
	 *
	 * The state that is passed in is the state of the request the read was
	 * taken for: the counters and the deduplication of the continuation
	 * belong to it and not to a request that replaced it in the meantime.
	 */
	private async decide(
		state: RequestLifecycleState,
		snapshot: RequestWorkSnapshot | null,
	): Promise<ContinuationDecision> {
		const view = readRequestWork(snapshot);
		const decision = decideContinuation(view, {
			recoveries: state.recoveries,
			maxRecoveries: this.options.maxRecoveries,
		});
		if (decision.action === "idle") {
			this.markTerminal(decision.reason);
			return decision;
		}
		if (decision.action === "unverified") {
			return decision;
		}
		if (decision.action === "wait") {
			// The request waits for the harness: it is not finished, and
			// the agent is not sent a continuation.
			return decision;
		}
		if (view.work === "unknown") {
			state.recoveries += 1;
		}
		// The same work is continued once while its queue entry is
		// outstanding. A queue entry that was consumed may be continued
		// again, but a work that does not progress is not continued for
		// ever: the request stops with a visible reason.
		const key = this.workKey(view);
		if (key && key === state.continuedFor) {
			if (state.outstanding) {
				return {
					action: "idle",
					reason: `the continuation for this work is still queued (${decision.reason})`,
					work: decision.work,
				};
			}
			state.continuations += 1;
			if (state.continuations >= this.maxContinuations) {
				const reason = `the request continued for the same work ${state.continuations} times without progress`;
				this.markTerminal(reason);
				return {
					action: "idle",
					reason: `${reason} (${decision.reason})`,
					work: decision.work,
				};
			}
		} else {
			state.continuations = 0;
		}
		if (key) {
			state.continuedFor = key;
			state.outstanding = true;
		}
		const sent = await this.send(decision);
		if (sent !== "sent") {
			// The message did not reach the agent: there is no queue entry,
			// and the work stays continuable.
			if (key) {
				state.continuedFor = "";
				state.outstanding = false;
			}
			return {
				action: "idle",
				reason:
					sent === "stale"
						? "the request ended while its state was read"
						: `the continuation was not sent (${decision.reason})`,
				work: decision.work,
			};
		}
		return decision;
	}

	/**
	 * The dispatch of the continuation.
	 *
	 * The dispatch rechecks the terminal state and the generation: the
	 * request may have ended while the state was read.
	 */
	private async send(decision: ContinuationDecision): Promise<"sent" | "refused" | "stale"> {
		if (!decision.instruction || !this.options.dispatch) return "sent";
		const state = this.state;
		if (state.terminal || this.generation !== state.generation) return "stale";
		const result = await this.options.dispatch(decision.instruction, decision);
		return result === false ? "refused" : "sent";
	}

	/**
	 * The continuation of the request was consumed.
	 *
	 * The queue entry of the continuation is gone: the run that carried it
	 * happened. The work of the request may be continued again, and the
	 * counter of the continuations without progress keeps its count.
	 */
	acknowledgeDelivery(generation?: number): void {
		const state = this.state;
		if (generation !== undefined && generation !== state.generation) return;
		state.outstanding = false;
	}

	/** The key of the open work, for the deduplication of the continuation. */
	private workKey(view: RequestWorkView): string {
		if (view.work !== "unfinished") return "";
		return view.open
			.map((item) => `${itemKey(item)}:${(item.status ?? "").trim()}`)
			.sort()
			.join("|");
	}
}
