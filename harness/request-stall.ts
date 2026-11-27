/**
 * The pause of a request that the human can see and lift.
 *
 * A request that did not progress is paused, not finished: its work stays
 * open, the issues it authorized stay authorized and the countdowns it
 * armed stay armed. The pause has to be visible - the reason in the row
 * of the footer and a notice once - and it has to be liftable through a
 * supported path, so the human does not have to guess what to do.
 *
 * The recovery never resets the request: it lifts the pause of the request
 * that is running, so the identity of the request and the scope it
 * authorized stay. The continuation itself goes through the guarded path
 * of the todos, so a pause of the session, a question of the human, an
 * exhausted quota and a duplicate entry still stop it.
 */

/**
 * The name of the command that lifts the pause of a request.
 */
export const REQUEST_RECOVERY_COMMAND_NAME = "harness-resume-request";

/**
 * The command that lifts the pause of a request.
 */
export const REQUEST_RECOVERY_COMMAND = `/${REQUEST_RECOVERY_COMMAND_NAME}`;

/**
 * What the host knows about the request that is running.
 */
export interface RequestStallFacts {
	/** Is the request paused because it did not progress? */
	stalled: boolean;
	/** Why the request is paused. */
	reason?: string;
	/** Has the request ended? */
	terminal?: boolean;
}

/**
 * The status of the pause, for the row of the footer.
 */
export interface RequestStallStatus {
	/** The key of the status. */
	key: "running" | "paused";
	/** The text that the footer shows. */
	text: string;
}

/**
 * The status of the pause of a request.
 *
 * The row is empty while the request runs: the pause is the only thing
 * the row has to say, and a row that repeats the work of the task list
 * would only make the footer noisier.
 */
export function stallStatus(facts: RequestStallFacts): RequestStallStatus {
	if (!facts.stalled) return { key: "running", text: "" };
	return {
		key: "paused",
		text: `paused: ${stallReason(facts)} The work of the request stays open. Run ${REQUEST_RECOVERY_COMMAND} to continue it.`,
	};
}

/**
 * The reason of the pause, as the human reads it.
 */
export function stallReason(facts: RequestStallFacts): string {
	const reason = facts.reason?.trim();
	if (!reason) return "the request did not progress.";
	if (/[.!?]$/.test(reason)) return reason;
	return `${reason}.`;
}

/**
 * The seams of the host of a paused request.
 */
export interface RequestStallHostOptions {
	/** Reads the state of the request that is running. */
	read: () => RequestStallFacts;
	/** Writes the row of the footer. */
	setStatus: (text: string) => void;
	/** Shows a notice to the human. */
	notify: (message: string, level: "info" | "warning" | "error") => void;
	/** Lifts the pause of the request. */
	resume: () => boolean;
	/**
	 * Continues the request through the guarded path.
	 *
	 * The continuation goes through the guards of the session, so the
	 * recovery of a paused request may not bypass a pause of the session,
	 * a question of the human or an exhausted quota.
	 */
	continue?: () => Promise<boolean | void> | boolean | void;
}

/**
 * The result of a recovery of a paused request.
 */
export interface RequestStallRecovery {
	/** Did the request continue? */
	ok: boolean;
	/** The message that the human reads. */
	message: string;
}

/**
 * The host of a paused request.
 *
 * The host owns what the human sees: the row of the footer and the notice
 * that says the request is paused. The notice is shown once per pause: a
 * request that stays paused must not repeat itself, and the row carries
 * the reason.
 */
export class RequestStallHost {
	private readonly options: RequestStallHostOptions;
	private notified = false;

	constructor(options: RequestStallHostOptions) {
		this.options = options;
	}

	/**
	 * Show the state of the request that is running.
	 *
	 * The method is called after every decision about the continuation, so
	 * the row of the footer never claims that the request runs while it is
	 * paused.
	 */
	sync(): void {
		let facts: RequestStallFacts;
		try {
			facts = this.options.read();
		} catch {
			// The state of the request cannot be read: the row keeps what
			// it showed, and a row that is stale is better than a row that
			// guesses.
			return;
		}
		const status = stallStatus(facts);
		try {
			this.options.setStatus(status.text);
		} catch {
			// A footer that refuses the row must not break the request.
		}
		if (!facts.stalled) {
			// The request runs again: a later pause is noticed again.
			this.notified = false;
			return;
		}
		if (this.notified) return;
		this.notified = true;
		try {
			this.options.notify(
				`The request is paused: ${stallReason(facts)} Its work stays open. Run ${REQUEST_RECOVERY_COMMAND} to continue it.`,
				"warning",
			);
		} catch {
			// A notice that fails must not break the request either.
		}
	}

	/**
	 * Lift the pause of the request that is running.
	 *
	 * The request is not reset: the identity of the request and the issues
	 * it authorized stay, and only the pause of a request that did not
	 * progress is lifted. A finished request is never continued.
	 */
	async recover(): Promise<RequestStallRecovery> {
		let facts: RequestStallFacts;
		try {
			facts = this.options.read();
		} catch {
			return {
				ok: false,
				message: "The state of the request could not be read.",
			};
		}
		if (facts.terminal) {
			return {
				ok: false,
				message: "The request is finished; there is nothing to continue.",
			};
		}
		if (!facts.stalled) {
			return {
				ok: false,
				message: "The request is not paused; it continues on its own.",
			};
		}
		let resumed = false;
		try {
			resumed = this.options.resume();
		} catch {
			resumed = false;
		}
		if (!resumed) {
			return {
				ok: false,
				message: "The request could not be continued.",
			};
		}
		// The pause is lifted: a later pause is noticed again.
		this.notified = false;
		let continued: boolean | void;
		try {
			continued = await this.options.continue?.();
		} catch {
			continued = false;
		}
		if (continued === false) {
			return {
				ok: false,
				message:
					"The pause of the request was lifted, but the request did not continue; the guards of the session stopped it.",
			};
		}
		return {
			ok: true,
			message:
				"The request continues. Its work and the issues it authorized stay.",
		};
	}
}
