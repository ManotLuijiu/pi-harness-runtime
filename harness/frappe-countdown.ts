/**
 * The countdown of a Frappe operation.
 *
 * A countdown is the confirmation of the human that expires. The expiry is
 * not an answer of the human: the operation runs only when the permission
 * that stands covers it, and the check before the dispatch pins the
 * proposal that was assessed. A countdown never runs a command of a bench:
 * it tells the agent that the confirmation expired and that it may run the
 * operation, and the agent runs it.
 *
 * The owner of the countdown is this module. The registry of the pending
 * actions holds the deadline and the row that the operator sees, and the
 * module keeps the pinned assessment that the expiry is checked against.
 * The rules that the module keeps:
 *
 * - a countdown that is not due is not fired,
 * - a countdown whose request was cancelled or replaced, whose code
 *   changed or whose permission ended authorizes nothing: the action is
 *   blocked and the agent is told that it may not run the operation,
 * - a countdown that authorizes the operation authorizes it once: the
 *   action leaves the registry when it fired,
 * - a dispatch that the session refused keeps the countdown, so the
 *   authorization is not lost while the session is busy,
 * - the request that ends forgets its countdowns.
 */

import type { PendingActionRegistry } from "./pending-actions.ts";
import {
	recheckFrappeOperation,
	type FrappeDispatchState,
	type FrappeOperationAssessment,
} from "./frappe-lifecycle-policy.ts";

/** One countdown of a Frappe operation. */
export interface FrappeCountdownEntry {
	/** The identity of the pending action. */
	actionId: string;
	/** The identity of the operation. */
	identity: string;
	/** The assessment that the expiry is checked against. */
	assessment: FrappeOperationAssessment;
	/** When the confirmation expires. */
	deadlineAt: number;
	/** The generation of the request that proposed the operation. */
	generation: number;
	/** The session of the request. */
	sessionId: string;
	/** The workspace of the operation. */
	workspace: string;
	/** The operation, in the words of the request. */
	proposal: string;
	/**
	 * The hash of the code that is there now.
	 *
	 * The assessment pins the hash of the file that was reviewed. The
	 * countdown reads the file again at the expiry: a file that changed
	 * in the meantime is another operation, and the confirmation of this
	 * one says nothing about it.
	 */
	currentHash?: () => string | undefined;
}

/** What the expiry of a countdown did. */
export type FrappeCountdownOutcomeKind =
	/** The operation may run. */
	| "authorized"
	/** The operation may not run. */
	| "blocked"
	/** The countdown is not due yet. */
	| "not-due";

/** The result of the expiry of a countdown. */
export interface FrappeCountdownOutcome {
	/** What the expiry did. */
	kind: FrappeCountdownOutcomeKind;
	/** The identity of the pending action. */
	actionId: string;
	/** The identity of the operation. */
	identity: string;
	/** Why the expiry did that. */
	reason: string;
}

/** The options of the countdown. */
export interface FrappeCountdownOptions {
	/** The registry of the pending actions. */
	pending: PendingActionRegistry;
	/**
	 * The state of the world at the moment of the expiry.
	 *
	 * The state is read once per expiry. It holds the request that runs
	 * now, the permission that is valid now and the flags of the
	 * cancellation and of the conflicts. A state that cannot be read is
	 * a state that authorizes nothing.
	 */
	state: () => Omit<FrappeDispatchState, "now">;
	/**
	 * The dispatch of the message to the agent.
	 *
	 * The dispatch is the guarded path of the session: it refuses when the
	 * session is busy or paused, and the countdown never forces a turn.
	 */
	dispatch: (
		message: string,
		entry: FrappeCountdownEntry,
	) => Promise<{ dispatched: boolean; reason?: string }>;
	/** The clock (the tests drive it). */
	now?: () => number;
	/** The timer that arms the next expiry (the tests drive it). */
	setTimeout?: (callback: () => void, delayMs: number) => unknown;
	/** The timer that stops the arming (the tests drive it). */
	clearTimeout?: (handle: unknown) => void;
	/** The log of the module. */
	log?: (message: string) => void;
}

/**
 * The message of an authorized operation.
 *
 * The message names the operation and says that it may run. It never says
 * that the human approved it: nobody approved it, the confirmation
 * expired.
 */
export function authorizedMessage(entry: FrappeCountdownEntry): string {
	return [
		`The confirmation of the operation expired and the permission that stands covers it.`,
		`You may run the operation now: ${entry.proposal}`,
		`The operation is the one that was assessed (${entry.identity}).`,
	].join("\n");
}

/**
 * The message of an operation that may not run.
 *
 * The message names the reason, so the agent does not run an operation
 * that lost its permission.
 */
export function refusedMessage(
	entry: FrappeCountdownEntry,
	reason: string,
): string {
	return [
		`The confirmation of the operation expired, but the operation may not run: ${reason}.`,
		`Do not run it: ${entry.proposal}`,
	].join("\n");
}

/**
 * The owner of the countdowns of the Frappe operations.
 */
export class FrappeCountdownDispatcher {
	private readonly options: FrappeCountdownOptions;
	private readonly entries = new Map<string, FrappeCountdownEntry>();
	private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;
	private handle: unknown = null;

	constructor(options: FrappeCountdownOptions) {
		this.options = options;
		this.setTimer =
			options.setTimeout ??
			((callback, delayMs) => setTimeout(callback, delayMs) as unknown);
		this.clearTimer =
			options.clearTimeout ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	}

	/** The clock of the module. */
	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	/**
	 * Remember a countdown.
	 *
	 * The row of the action is the one of the registry: the operator sees
	 * the deadline of the confirmation there.
	 */
	remember(entry: FrappeCountdownEntry): FrappeCountdownEntry {
		this.entries.set(entry.actionId, entry);
		// The row of the countdown belongs to its owner: the operator sees
		// the deadline of the confirmation in the status row. A row that
		// is already there (the dispatch of the policy registered it) is
		// kept: one action is one row.
		if (!this.options.pending.get(entry.actionId)) {
			this.options.pending.register({
				id: entry.actionId,
				sessionId: entry.sessionId,
				owner: "frappe-lifecycle",
				kind: "resume",
				state: "scheduled",
				dueAt: entry.deadlineAt,
				reason: "the confirmation of the operation expires",
			});
		}
		this.arm();
		return entry;
	}

	/** The countdowns that the module knows. */
	list(): FrappeCountdownEntry[] {
		return [...this.entries.values()];
	}

	/**
	 * Forget the countdowns of a request.
	 *
	 * The request that ends owns its countdowns: a countdown of a request
	 * that was cancelled may never authorize anything.
	 */
	forget(generation: number): number {
		let forgotten = 0;
		for (const entry of [...this.entries.values()]) {
			if (entry.generation !== generation) continue;
			this.entries.delete(entry.actionId);
			this.options.pending.remove(entry.actionId);
			forgotten += 1;
		}
		if (forgotten > 0) this.arm();
		return forgotten;
	}

	/**
	 * The countdowns whose deadline passed.
	 */
	due(): FrappeCountdownEntry[] {
		const now = this.now();
		return this.list().filter((entry) => entry.deadlineAt <= now);
	}

	/**
	 * Fire the countdowns that are due.
	 *
	 * Every due countdown is checked on its own: one that is blocked does
	 * not hold the others.
	 */
	async fire(): Promise<FrappeCountdownOutcome[]> {
		const outcomes: FrappeCountdownOutcome[] = [];
		for (const entry of this.due()) {
			outcomes.push(await this.fireOne(entry));
		}
		this.arm();
		return outcomes;
	}

	/**
	 * The expiry of one countdown.
	 */
	private async fireOne(entry: FrappeCountdownEntry): Promise<FrappeCountdownOutcome> {
		const recheck = this.recheck(entry);
		if (!recheck.ok) {
			return this.block(entry, recheck.reason);
		}
		return this.authorize(entry);
	}

	/**
	 * The check of the operation before the expiry.
	 *
	 * A state that cannot be read authorizes nothing: the countdown is
	 * blocked instead of running an operation that lost its permission.
	 */
	private recheck(entry: FrappeCountdownEntry): { ok: boolean; reason: string } {
		let state: Omit<FrappeDispatchState, "now">;
		try {
			state = this.options.state();
		} catch (error) {
			return {
				ok: false,
				reason: `the state of the request could not be read (${
					error instanceof Error ? error.message : String(error)
				})`,
			};
		}
		return recheckFrappeOperation(entry.assessment, {
			...state,
			// The hash of the file of the routine is read at the expiry:
			// the code that was reviewed has to be the code that is there.
			...(entry.assessment.reviewedHash
				? { currentHash: entry.currentHash?.() }
				: {}),
			now: this.now(),
		});
	}

	/**
	 * The operation may run: the agent is told so.
	 */
	private async authorize(
		entry: FrappeCountdownEntry,
	): Promise<FrappeCountdownOutcome> {
		const result = await this.options.dispatch(authorizedMessage(entry), entry);
		if (!result.dispatched) {
			// The session refused the message: the authorization is not
			// lost, the countdown stays and it may fire again.
			this.options.log?.(
				`[frappe] The confirmation of ${entry.identity} expired, but the dispatch was refused: ${
					result.reason ?? "no reason"
				}`,
			);
			return {
				kind: "authorized",
				actionId: entry.actionId,
				identity: entry.identity,
				reason: `the operation may run, but the dispatch was refused (${
					result.reason ?? "no reason"
				})`,
			};
		}
		this.entries.delete(entry.actionId);
		this.options.pending.remove(entry.actionId);
		this.options.log?.(
			`[frappe] The confirmation of ${entry.identity} expired: the operation may run`,
		);
		return {
			kind: "authorized",
			actionId: entry.actionId,
			identity: entry.identity,
			reason: "the confirmation expired and the permission covers the operation",
		};
	}

	/**
	 * The operation may not run: the action is blocked and the agent is
	 * told that it may not run the operation.
	 */
	private async block(
		entry: FrappeCountdownEntry,
		reason: string,
	): Promise<FrappeCountdownOutcome> {
		this.entries.delete(entry.actionId);
		this.options.pending.update(entry.actionId, {
			state: "blocked",
			reason,
		});
		this.options.log?.(
			`[frappe] The confirmation of ${entry.identity} expired, but the operation may not run: ${reason}`,
		);
		await this.options.dispatch(refusedMessage(entry, reason), entry);
		return {
			kind: "blocked",
			actionId: entry.actionId,
			identity: entry.identity,
			reason,
		};
	}

	/**
	 * Arm the next expiry.
	 *
	 * The timer belongs to this module and to the countdowns it knows: a
	 * countdown that is forgotten leaves no timer behind.
	 */
	private arm(): void {
		if (this.handle !== null) {
			this.clearTimer(this.handle);
			this.handle = null;
		}
		const next = this.nextDeadline();
		if (next === undefined) return;
		const delay = Math.max(0, next - this.now());
		this.handle = this.setTimer(() => {
			this.handle = null;
			void this.fire();
		}, delay);
	}

	/** The deadline of the next countdown. */
	private nextDeadline(): number | undefined {
		let next: number | undefined;
		for (const entry of this.entries.values()) {
			if (next === undefined || entry.deadlineAt < next) next = entry.deadlineAt;
		}
		return next;
	}

	/** Stop the timer of the module. */
	stop(): void {
		if (this.handle !== null) {
			this.clearTimer(this.handle);
			this.handle = null;
		}
	}
}
