/**
 * The status of the task list of the session.
 *
 * An agent that stopped is not an agent that completed the request. An
 * empty list is not evidence of completion, and an unreadable list is
 * not evidence of anything at all. The status therefore shows what was
 * observed and never what it guesses: it names the work that is open,
 * and it says that a completion is unverified when nothing proves it.
 *
 * The status is informational. It never restarts the agent, never
 * creates a task, never clears a pause and never announces a
 * completion.
 */

/**
 * The shape of a todo that the status reads.
 */
export interface TaskTrackingTodo {
	/** The subject of the todo. */
	subject?: string;
	/** The state of the todo. */
	status?: string;
}

/**
 * The states of a todo that are still open.
 */
const OPEN_STATUSES = new Set(["pending", "in_progress"]);

/**
 * The state of a todo that is finished.
 */
const COMPLETED_STATUS = "completed";

/**
 * What the status knows about the session.
 */
export interface TaskTrackingFacts {
	/** Is the agent working right now? */
	running: boolean;
	/**
	 * The todos of the current request.
	 *
	 * `undefined` means that the list could not be read: the provider
	 * is missing, or the read failed. That is not the same as an empty
	 * list, and the status says so.
	 */
	todos: TaskTrackingTodo[] | undefined;
	/** Is a required validation of the work still pending? */
	validationPending?: boolean;
	/** Did a required validation of the work fail? */
	validationFailed?: boolean;
}

/**
 * The key of the status, for the tests and the log.
 */
export type TaskTrackingStatusKey =
	| "working-no-todos"
	| "stopped-no-todos"
	| "todos-unavailable"
	| "working-open"
	| "stopped-open"
	| "working-completed"
	| "stopped-completed";

/**
 * The status of the task list.
 */
export interface TaskTrackingStatus {
	/** The key of the status. */
	key: TaskTrackingStatusKey;
	/** The text that the footer shows. */
	text: string;
}

/**
 * The open todos of the request.
 */
export function openTodos(
	todos: TaskTrackingTodo[] | undefined,
): TaskTrackingTodo[] {
	if (!Array.isArray(todos)) return [];
	return todos.filter((todo) => {
		const status = typeof todo?.status === "string" ? todo.status : "";
		return OPEN_STATUSES.has(status);
	});
}

/**
 * The failure of a read of the task list, when the read failed.
 *
 * The provider answers with an empty list when it could not read the
 * list, and names the failure in its last error. An empty list that is
 * really a failure must not look like a list without work: the row
 * would say "no Todos" about a list that nobody ever saw.
 */
export function todoReadFailure(lastError: unknown): string | undefined {
	if (typeof lastError !== "string") return undefined;
	const trimmed = lastError.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The todos of the request that are finished.
 *
 * A todo that was finished is not a todo that never existed: the row
 * must not say "no Todos" about a request that has them.
 */
export function completedTodos(
	todos: TaskTrackingTodo[] | undefined,
): TaskTrackingTodo[] {
	if (!Array.isArray(todos)) return [];
	return todos.filter((todo) => {
		const status = typeof todo?.status === "string" ? todo.status : "";
		return status === COMPLETED_STATUS;
	});
}

/**
 * The status of the task list.
 */
export function taskTrackingStatus(
	facts: TaskTrackingFacts,
): TaskTrackingStatus {
	if (facts.todos === undefined) {
		return {
			key: "todos-unavailable",
			text: "[TASK] Todos unavailable - completion unverified",
		};
	}
	const tracked = facts.todos.length;
	const open = openTodos(facts.todos);
	const done = completedTodos(facts.todos).length;
	// The validation of the work is named first: it says more about the
	// completion than the count of the todos does.
	const validation = facts.validationPending === true
		? "validation pending; "
		: facts.validationFailed === true
			? "validation failed; "
			: "";
	if (facts.running) {
		if (tracked === 0) {
			return {
				key: "working-no-todos",
				text: "[TASK] Working - no Todos yet",
			};
		}
		if (open.length === 0) {
			return {
				key: "working-completed",
				text: `[TASK] Working - ${done} Todos completed`,
			};
		}
		return {
			key: "working-open",
			text: `[TASK] Working - ${open.length} open Todos`,
		};
	}
	if (tracked === 0) {
		return {
			key: "stopped-no-todos",
			text: validation
				? `[TASK] Stopped - ${validation}completion unverified; no Todos`
				: "[TASK] Stopped - completion unverified; no Todos",
		};
	}
	if (open.length === 0) {
		return {
			key: "stopped-completed",
			text: validation
				? `[TASK] Stopped - ${done} Todos completed; ${validation}completion unverified`
				: `[TASK] Stopped - ${done} Todos completed; completion unverified`,
		};
	}
	return {
		key: "stopped-open",
		text: validation
			? `[TASK] Stopped - ${open.length} open Todos remain; ${validation}completion unverified`
			: `[TASK] Stopped - ${open.length} open Todos remain`,
	};
}

/**
 * The status of the task list of a session.
 *
 * The controller owns what the footer shows and nothing else. A read
 * that arrives late never overwrites a newer state: the revision of the
 * activity fences it, so a slow read of an old request cannot replace
 * the row of the current one.
 */
export class TaskTrackingStatusController {
	private running = false;
	private todos: TaskTrackingTodo[] | undefined;
	private validationPending = false;
	private validationFailed = false;
	/** Has the task list been read at all? */
	private known = false;
	/** The revision of the activity. Every event that changes the state bumps it. */
	private revision = 0;
	/** The number of the read that is in flight. The newest read wins. */
	private refreshSeq = 0;

	/** The agent started working. */
	agentStarted(): void {
		this.running = true;
		this.revision += 1;
	}

	/** The agent settled: the work of the request stopped. */
	agentSettled(): void {
		this.running = false;
		this.revision += 1;
	}

	/** The session was replaced: nothing of the old session is known. */
	reset(): void {
		this.running = false;
		this.todos = undefined;
		this.validationPending = false;
		this.validationFailed = false;
		this.known = false;
		this.revision += 1;
	}

	/**
	 * The state of the task list changed.
	 *
	 * `undefined` means that the list could not be read.
	 */
	stateChanged(todos: TaskTrackingTodo[] | undefined): void {
		this.todos = todos;
		this.known = true;
		this.revision += 1;
	}

	/**
	 * The validation of the work changed.
	 */
	validationChanged(pending: boolean, failed = false): void {
		this.validationPending = pending;
		this.validationFailed = failed;
		this.revision += 1;
	}

	/**
	 * Read the task list and keep it, unless a newer event happened
	 * while the read was in flight.
	 *
	 * A read that arrives late is dropped: the state it would write
	 * belongs to a moment that has passed.
	 */
	async refresh(
		read: () => Promise<{
			todos: TaskTrackingTodo[] | undefined;
			validationPending?: boolean;
			validationFailed?: boolean;
		}>,
	): Promise<void> {
		const revision = this.revision;
		const seq = ++this.refreshSeq;
		let state: {
			todos: TaskTrackingTodo[] | undefined;
			validationPending?: boolean;
			validationFailed?: boolean;
		};
		try {
			state = await read();
		} catch {
			state = { todos: undefined };
		}
		if (revision !== this.revision) return;
		// Two reads can be in flight at the same time. The one that started
		// last holds the newer state, so the older one is dropped instead
		// of overwriting it.
		if (seq !== this.refreshSeq) return;
		this.revision += 1;
		this.todos = state.todos;
		this.known = true;
		this.validationPending = state.validationPending === true;
		this.validationFailed = state.validationFailed === true;
	}

	/**
	 * The status that the footer shows.
	 *
	 * `undefined` means that the task list was never read: the row stays
	 * away until the harness knows something about the list. A row that
	 * says "unavailable" before the first read would blame a provider
	 * that nobody asked yet.
	 */
	status(): TaskTrackingStatus | undefined {
		if (!this.known) return undefined;
		return taskTrackingStatus({
			running: this.running,
			todos: this.todos,
			validationPending: this.validationPending,
			validationFailed: this.validationFailed,
		});
	}
}
