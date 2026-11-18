/**
 * The reminder that asks the agent to record its work in the task list.
 *
 * The task list is what survives a full context window. The agent reads
 * its todos again after a compaction, and the harness reads them for the
 * phase of the work: an agent that does not record its work loses the
 * work when the context window is full.
 *
 * The reminder is occasional on purpose. A nudge in every turn is noise,
 * and a nudge that the agent cannot act on is worse than no nudge at all.
 * The reminder goes out when the work of the session is not in the task
 * list, and a pause has passed since the last one. The caller decides
 * *when* to check - at the start of a request, under the pressure of a
 * filling context window, or after a compaction - and this module
 * decides whether the reminder is due.
 */

/**
 * The shape of a todo that the reminder reads.
 *
 * The harness has its own shape of a todo; this one is the part the
 * reminder needs, so the module can be tested without the session.
 */
export interface TodoReminderTodo {
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
 * The pause between two reminders.
 *
 * Three minutes is long enough that a burst of occasions does not turn
 * into a burst of reminders, and short enough that a session that keeps
 * working without a task list is reminded again soon.
 */
export const TODO_REMINDER_COOLDOWN_MS = 3 * 60 * 1000;

/**
 * What the reminder knows about the session.
 */
export interface TodoReminderFacts {
	/**
	 * The todos of the session.
	 *
	 * `undefined` means that the list cannot be read: an agent that cannot
	 * add a task cannot act on the nudge, so no nudge goes out.
	 */
	todos: TodoReminderTodo[] | undefined;
	/** The occasion of the check. */
	occasion: string;
	/** When the last reminder went out. */
	lastReminderAt?: number;
	/** The pause between two reminders. */
	cooldownMs?: number;
	/** The clock. */
	now: number;
}

/**
 * The decision of the reminder.
 */
export interface TodoReminderDecision {
	/** Does the reminder go out? */
	remind: boolean;
	/** Why, in one line for the log. */
	reason: string;
	/** The text for the agent, when the reminder goes out. */
	text?: string;
}

/**
 * The open todos of the session.
 */
export function openTodos(
	todos: TodoReminderTodo[] | undefined,
): TodoReminderTodo[] {
	if (!Array.isArray(todos)) return [];
	return todos.filter((todo) => {
		const status = typeof todo?.status === "string" ? todo.status : "";
		return OPEN_STATUSES.has(status);
	});
}

/**
 * Is the work of the session in the task list?
 *
 * One open todo is enough: the agent has recorded something, and the
 * list is not empty because of a mistake.
 */
export function workIsTracked(todos: TodoReminderTodo[] | undefined): boolean {
	return openTodos(todos).length > 0;
}

/**
 * The text of the reminder.
 *
 * The text asks; it does not instruct. It names the reason the reminder
 * is there: the task list is what survives a full context window.
 */
export function todoReminderText(): string {
	return [
		"The task list of this session does not hold the work of this request.",
		"Use todo (the local Todos list, not bd). Read the pending and the",
		"in_progress items before creating anything; reuse the existing items and",
		"avoid duplicates. If this request has two or more steps, add the missing",
		"steps now: one item per step, the subject in the imperative, and the",
		"description with what the step is and how it is checked. Update progress,",
		"blockers and the exact next action, and mark an item completed only when",
		"its required validation has passed. Do not start unrelated backlog work.",
		"The task list is what survives a full context window: without it the work",
		"of this request is lost when the window fills.",
	].join(" ");
}

/**
 * Should the reminder go out?
 */
export function decideTodoReminder(
	facts: TodoReminderFacts,
): TodoReminderDecision {
	if (facts.todos === undefined) {
		return {
			remind: false,
			reason: "the task list of the session cannot be read",
		};
	}
	if (workIsTracked(facts.todos)) {
		return { remind: false, reason: "the work is already in the task list" };
	}
	const cooldown = facts.cooldownMs ?? TODO_REMINDER_COOLDOWN_MS;
	if (
		facts.lastReminderAt !== undefined &&
		facts.now - facts.lastReminderAt < cooldown
	) {
		return {
			remind: false,
			reason: "a reminder went out recently",
		};
	}
	return {
		remind: true,
		reason: `the work of the session is not in the task list (${facts.occasion})`,
		text: todoReminderText(),
	};
}
