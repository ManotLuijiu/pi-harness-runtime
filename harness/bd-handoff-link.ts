/**
 * The link between a handoff, its issue and the todos of the session.
 *
 * One logical request has one handoff id and one correlation id. The
 * issue of the store and the todos of the session both point at it, so
 * the two delivery paths - a live worker and the store - produce one
 * execution and not two.
 *
 * The link is carried by the metadata of a todo, so it survives a
 * restart of the session: the todo list is durable, and the metadata is
 * part of it.
 *
 * The closure check lives here too. A handoff whose issue was closed by
 * somebody else is finished: a pending resume of that work must not
 * start it again, and a closed issue is never read as "look for another
 * issue".
 */

/**
 * The metadata of a todo that names the store.
 */
export const BD_ISSUE_ID_METADATA_KEY = "bdIssueId";

/**
 * The metadata of a todo that names the handoff.
 */
export const BD_HANDOFF_ID_METADATA_KEY = "handoffId";

/**
 * The metadata of a todo that names the correlation of the request.
 */
export const BD_CORRELATION_ID_METADATA_KEY = "correlationId";

/**
 * The part of a todo the link needs.
 */
export interface LinkableTodo {
	/** The id of the todo. */
	id: number;
	/** The status of the todo. */
	status: string;
	/** The metadata of the todo. */
	metadata?: Record<string, unknown>;
}

/**
 * The identity of a handoff.
 *
 * The identity names the handoff itself. It is written into the metadata
 * of a todo, and it is what a todo of a handoff carries.
 */
export interface BdHandoffIdentity {
	/** The issue of the store. */
	bdIssueId?: string;
	/** The handoff. */
	handoffId?: string;
	/** The correlation of the request. */
	correlationId?: string;
}

/**
 * The link of one todo.
 */
export interface BdTodoLink extends BdHandoffIdentity {
	/** The id of the todo. */
	todoId: number;
}

/**
 * A string of the metadata, when it is one.
 */
function metaString(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	if (!metadata) return undefined;
	const value = metadata[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The link of a todo, when it has one.
 *
 * A todo without the metadata is a todo of the session and not of the
 * store: it has no link.
 */
export function linkOfTodo(todo: LinkableTodo): BdTodoLink | null {
	const bdIssueId = metaString(todo.metadata, BD_ISSUE_ID_METADATA_KEY);
	const handoffId = metaString(todo.metadata, BD_HANDOFF_ID_METADATA_KEY);
	const correlationId = metaString(todo.metadata, BD_CORRELATION_ID_METADATA_KEY);
	if (!bdIssueId && !handoffId && !correlationId) return null;
	const link: BdTodoLink = { todoId: todo.id };
	if (bdIssueId) link.bdIssueId = bdIssueId;
	if (handoffId) link.handoffId = handoffId;
	if (correlationId) link.correlationId = correlationId;
	return link;
}

/**
 * The links of a list of todos.
 */
export function linksOfTodos(todos: readonly LinkableTodo[]): BdTodoLink[] {
	const links: BdTodoLink[] = [];
	for (const todo of todos) {
		const link = linkOfTodo(todo);
		if (link) links.push(link);
	}
	return links;
}

/**
 * The todos that belong to one issue of the store.
 */
export function todosOfIssue(
	todos: readonly LinkableTodo[],
	bdIssueId: string,
): number[] {
	return linksOfTodos(todos)
		.filter((link) => link.bdIssueId === bdIssueId)
		.map((link) => link.todoId);
}

/**
 * The decision about a queued piece of work whose issue was closed.
 */
export type BdClosureDecision =
	| {
			/** The work may continue. */
			action: "continue";
			/** Why. */
			reason: string;
	  }
	| {
			/** The work is finished elsewhere and must not start again. */
			action: "suppress";
			/** Why. */
			reason: string;
			/** The issue that was closed. */
			bdIssueId: string;
			/** The todos that are finished with it. */
			todoIds: number[];
	  }
	| {
			/**
			 * The state of the issue is unknown.
			 *
			 * A missing issue and a read that failed are not a closure:
			 * the work waits for a read that works.
			 */
			action: "unknown";
			/** Why. */
			reason: string;
			/** The issue that could not be read. */
			bdIssueId: string;
	  };

/**
 * The closure of a piece of work.
 *
 * The check is asked for one issue at a time: the state of one issue does
 * not say anything about another one.
 */
export function decideClosure(input: {
	/** The issue of the work. */
	bdIssueId: string;
	/** The status of the issue, when it was read. */
	status?: string;
	/** Did the read of the issue work? */
	readable: boolean;
	/** The todos of the work. */
	todoIds?: number[];
}): BdClosureDecision {
	if (!input.readable) {
		return {
			action: "unknown",
			reason: `the issue ${input.bdIssueId} could not be read`,
			bdIssueId: input.bdIssueId,
		};
	}
	if (input.status === "closed") {
		return {
			action: "suppress",
			reason: `the issue ${input.bdIssueId} was closed before the work started`,
			bdIssueId: input.bdIssueId,
			todoIds: input.todoIds ?? [],
		};
	}
	return {
		action: "continue",
		reason: `the issue ${input.bdIssueId} is still open`,
	};
}

/**
 * The closure of a whole request.
 *
 * The work of a request is finished when every issue it points at was
 * closed. A request that points at one closed issue and one open issue
 * still has work, and the open one decides.
 */
export function decideRequestClosure(input: {
	/** The links of the todos of the request. */
	links: readonly BdTodoLink[];
	/** The state of every issue of the store that was read. */
	states: ReadonlyMap<string, { readable: boolean; missing?: boolean; status?: string }>;
}): BdClosureDecision {
	const issues = [
		...new Set(
			input.links
				.map((link) => link.bdIssueId)
				.filter((id): id is string => typeof id === "string"),
		),
	];
	if (issues.length === 0) {
		return { action: "continue", reason: "the request points at no issue of the store" };
	}
	// The issues that do not exist any more. They are finished, so they do
	// not keep the work of the request alive.
	const missing: string[] = [];
	for (const issueId of issues) {
		const state = input.states.get(issueId);
		if (!state || !state.readable) {
			if (state?.missing) {
				// The issue does not exist any more. It is finished: it
				// will never be read again, and the work of the handoff is
				// not started again either. It is not the end of the whole
				// request: the other issues of the request still decide, and
				// an issue that is still open is work that waits.
				missing.push(issueId);
				continue;
			}
			return {
				action: "unknown",
				reason: `the issue ${issueId} could not be read`,
				bdIssueId: issueId,
			};
		}
		if (state.status !== "closed") {
			return {
				action: "continue",
				reason: `the issue ${issueId} is still open`,
			};
		}
	}
	const todoIds = input.links
		.filter((link) => link.bdIssueId && issues.includes(link.bdIssueId))
		.map((link) => link.todoId);
	return {
		action: "suppress",
		reason:
			missing.length > 0
				? `every issue of the request was closed or does not exist any more: ${issues.join(", ")}`
				: `every issue of the request was closed: ${issues.join(", ")}`,
		bdIssueId: issues[0],
		todoIds,
	};
}
