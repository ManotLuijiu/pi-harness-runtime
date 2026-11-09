/**
 * The pending automatic actions of a session.
 *
 * Every automatic action of the harness - a resume, a retry, a quota check,
 * the decision of the judge - has one owner, and that owner schedules the
 * action. This registry is the shared view of those actions: it holds what
 * is pending, it renders it truthfully, and it never schedules anything
 * itself.
 *
 * The rules of the registry:
 *
 * - The executor stays the owner of the execution. It registers the exact
 *   deadline it scheduled, updates the entry when it reschedules, and
 *   removes it when the action was cancelled, fired, completed or blocked.
 * - The renderer observes. A tick draws a row; it never dispatches an
 *   action, never sends a message and never notifies a channel.
 * - A row never claims a deadline that does not exist. An action without a
 *   known deadline shows its real state (queued, running, blocked) instead
 *   of an invented countdown.
 */

/** What an automatic action does. */
export type PendingActionKind =
	| "resume"
	| "retry"
	| "quota-check"
	| "jev-decision";

/** Where an automatic action stands. */
export type PendingActionState =
	/** The action is scheduled for a known deadline. */
	| "scheduled"
	/** The action is ready to run, but nothing runs it yet. */
	| "queued"
	/** The action runs right now. */
	| "running"
	/** The action cannot run, and nothing retries it. */
	| "blocked";

/**
 * One pending automatic action.
 */
export interface PendingAction {
	/** The identity of the action. It is unique in the registry. */
	id: string;
	/** The Pi session the action belongs to. */
	sessionId: string;
	/** The owner of the action: the code that scheduled it. */
	owner: string;
	/** What the action does. */
	kind: PendingActionKind;
	/** Where the action stands. */
	state: PendingActionState;
	/** The deadline of the action in milliseconds since the epoch. */
	dueAt?: number;
	/** The provider the action belongs to. */
	provider?: string;
	/** The code the provider reported (2067, 429, ...). */
	code?: string;
	/** The attempt the action is. */
	attempt?: number;
	/** The number of attempts the owner allows. */
	maxAttempts?: number;
	/** A short, truthful reason for the row. */
	reason: string;
}

/**
 * The registry of the pending automatic actions.
 */
export interface PendingActionRegistry {
	/**
	 * Register an action. An action with a known identity replaces the
	 * entry it replaces, so a reschedule is one move.
	 */
	register(entry: PendingAction): PendingAction;
	/** Change the fields of an action. */
	update(
		id: string,
		patch: Partial<Omit<PendingAction, "id">>,
	): PendingAction | null;
	/** Remove an action. It reports whether the action was there. */
	remove(id: string): boolean;
	/** The action with that identity, when it is there. */
	get(id: string): PendingAction | null;
	/** Every action, in the order they were registered. */
	list(): PendingAction[];
	/** Remove every action the predicate matches. It reports the count. */
	removeWhere(predicate: (action: PendingAction) => boolean): number;
	/**
	 * Listen for the changes of the registry.
	 *
	 * The listener is called after every change. It returns the function
	 * that removes the listener again.
	 */
	subscribe(listener: () => void): () => void;
	/** Remove every action. */
	clear(): void;
}

/**
 * The options of a registry.
 */
export interface PendingActionRegistryOptions {
	/**
	 * Called after every change of the registry.
	 *
	 * The ticker of the rows uses it to draw the rows at once, so a new
	 * action does not wait for the next tick.
	 */
	onChange?: () => void;
}

/**
 * Create a registry of pending automatic actions.
 */
export function createPendingActionRegistry(
	options: PendingActionRegistryOptions = {},
): PendingActionRegistry {
	const entries = new Map<string, PendingAction>();
	const listeners = new Set<() => void>();
	const changed = (): void => {
		for (const listener of Array.from(listeners)) listener();
		options.onChange?.();
	};
	return {
		register(entry: PendingAction): PendingAction {
			const stored: PendingAction = { ...entry };
			entries.set(entry.id, stored);
			changed();
			return stored;
		},
		update(
			id: string,
			patch: Partial<Omit<PendingAction, "id">>,
		): PendingAction | null {
			const current = entries.get(id);
			if (!current) return null;
			const updated: PendingAction = { ...current, ...patch, id };
			entries.set(id, updated);
			changed();
			return updated;
		},
		remove(id: string): boolean {
			const removed = entries.delete(id);
			if (removed) changed();
			return removed;
		},
		get(id: string): PendingAction | null {
			return entries.get(id) ?? null;
		},
		list(): PendingAction[] {
			return Array.from(entries.values());
		},
		removeWhere(predicate: (action: PendingAction) => boolean): number {
			let removed = 0;
			for (const [id, action] of Array.from(entries.entries())) {
				if (!predicate(action)) continue;
				entries.delete(id);
				removed += 1;
			}
			if (removed > 0) changed();
			return removed;
		},
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		clear(): void {
			if (entries.size === 0) return;
			entries.clear();
			changed();
		},
	};
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

/**
 * The name of an action in a status row.
 */
export function pendingActionLabel(action: PendingAction): string {
	const provider = action.provider;
	const code = action.code ? ` ${action.code}` : "";
	switch (action.kind) {
		case "jev-decision":
			return "Jev decision";
		case "quota-check":
			return `${provider ?? "quota"}${code} quota check`;
		case "retry":
			return provider ? `${provider}${code}` : "provider retry";
		case "resume":
		default:
			return provider ? `${provider}${code}` : "provider resume";
	}
}

/**
 * The verb of the row.
 *
 * The verb names what the countdown is waiting for, so a row never claims
 * that a decision is a resume or the other way round.
 */
function pendingActionVerb(action: PendingAction): string {
	switch (action.kind) {
		case "jev-decision":
			return "decision";
		case "quota-check":
			return "check";
		case "retry":
		case "resume":
		default:
			return "auto-resume";
	}
}

/**
 * The row of one action.
 *
 * A scheduled action with a deadline counts down. Every other state shows
 * what it really is: an action without a known deadline never shows a
 * countdown.
 */
export function formatPendingAction(
	action: PendingAction,
	now: number,
): string {
	const label = pendingActionLabel(action);
	const attempt =
		action.attempt !== undefined
			? `attempt ${action.attempt}${
					action.maxAttempts !== undefined ? `/${action.maxAttempts}` : ""
				}`
			: "";
	const reason = action.reason ? action.reason : "";

	switch (action.state) {
		case "scheduled": {
			if (action.dueAt === undefined || !Number.isFinite(action.dueAt)) {
				return row("WAIT", label, ["scheduled", attempt, reason]);
			}
			const remaining = formatRemainingTime(action.dueAt - now);
			return row("WAIT", label, [
				`${pendingActionVerb(action)} in ${remaining}`,
				attempt,
				reason,
			]);
		}
		case "queued":
			return row("WAIT", label, ["queued", attempt, reason]);
		case "running":
			return row("RUN", label, ["running", attempt, reason]);
		case "blocked":
		default:
			return row("BLOCKED", label, [reason]);
	}
}

/**
 * Join the parts of a row.
 *
 * Empty parts leave no gap behind, so a row never shows a dangling
 * separator.
 */
function row(state: string, label: string, parts: string[]): string {
	const segments = parts.filter((part) => part.length > 0);
	return segments.length > 0
		? `[${state}] ${label} | ${segments.join(" | ")}`
		: `[${state}] ${label}`;
}

/**
 * The rows of every action.
 *
 * The blocked actions come first: a blocked provider must stay visible even
 * when another action has a countdown. The scheduled actions follow, the
 * nearest deadline first.
 */
export function formatPendingActions(
	actions: PendingAction[],
	now: number,
): string[] {
	const blocked = actions.filter((action) => action.state === "blocked");
	const rest = actions.filter((action) => action.state !== "blocked");
	const byDeadline = (a: PendingAction, b: PendingAction): number => {
		const left = a.dueAt ?? Number.POSITIVE_INFINITY;
		const right = b.dueAt ?? Number.POSITIVE_INFINITY;
		if (left === right) return 0;
		return left - right;
	};
	return [
		...blocked.map((action) => formatPendingAction(action, now)),
		...rest.sort(byDeadline).map((action) => formatPendingAction(action, now)),
	];
}

/**
 * The dependencies of the ticker of the rows.
 */
export interface PendingActionTickerDeps {
	/** The registry the ticker observes. */
	registry: PendingActionRegistry;
	/** Draw the rows. The ticker never dispatches an action. */
	render: (rows: string[]) => void;
	/** The clock (the tests drive it). */
	now?: () => number;
	/** The timer that drives the ticks (the tests drive it). */
	setInterval?: (callback: () => void, ms: number) => unknown;
	/** The timer that stops the ticks (the tests drive it). */
	clearInterval?: (handle: unknown) => void;
	/** The tick interval in milliseconds. */
	tickMs?: number;
}

/**
 * The ticker of the rows.
 */
export interface PendingActionTicker {
	/** Start the ticker and draw the rows once. */
	start(): void;
	/** Stop the ticker. */
	stop(): void;
	/** Draw the rows once. The tests drive it. */
	tick(): void;
	/** Is the ticker running? */
	readonly active: boolean;
}

/** The milliseconds between two ticks of the rows. */
const TICK_MS = 1_000;

/**
 * Create the ticker of the rows.
 *
 * The ticker redraws once per second while an action is pending and stops
 * itself when there is nothing to draw. A tick never dispatches an action:
 * the display and the execution stay apart.
 */
export function createPendingActionTicker(
	deps: PendingActionTickerDeps,
): PendingActionTicker {
	const now = deps.now ?? (() => Date.now());
	const setTimer = deps.setInterval ?? ((cb, ms) => setInterval(cb, ms));
	const clearTimer =
		deps.clearInterval ?? ((handle: unknown) => clearInterval(handle as never));
	const tickMs = deps.tickMs ?? TICK_MS;

	let handle: unknown = null;
	let running = false;

	const draw = (): void => {
		const rows = formatPendingActions(deps.registry.list(), now());
		deps.render(rows);
	};

	const ticker: PendingActionTicker = {
		start(): void {
			if (running) return;
			running = true;
			draw();
			handle = setTimer(() => ticker.tick(), tickMs);
		},
		stop(): void {
			running = false;
			if (handle !== null) {
				clearTimer(handle);
				handle = null;
			}
		},
		tick(): void {
			if (!running) return;
			draw();
			// Nothing to draw: the ticker stops itself, so it never keeps the
			// event loop of the harness busy for an empty row set. A new
			// action starts it again.
			if (deps.registry.list().length === 0) {
				ticker.stop();
			}
		},
		get active(): boolean {
			return running;
		},
	};

	// A change of the registry draws the rows at once: a new action does
	// not wait for the next tick, and a removed action leaves the row at
	// once.
	deps.registry.subscribe(() => {
		if (running) ticker.tick();
		else ticker.start();
	});

	return ticker;
}
