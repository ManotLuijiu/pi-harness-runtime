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

import { captureInstruction, uncoveredSteps } from "./request-capture.ts";

/**
 * The shape of a todo that the reminder reads.
 *
 * The harness has its own shape of a todo; this one is the part the
 * reminder needs, so the module can be tested without the session.
 *
 * The todos are the ones of the request that is running: the caller
 * filters the list of the session through the scope of the request. A
 * todo of an earlier request is not the work of this one, and it must
 * not silence the reminder about the work that is missing.
 */
export interface TodoReminderTodo {
	/** The subject of the todo. */
	subject?: string;
	/** The description of the todo. */
	description?: string;
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
	 * The todos of the request.
	 *
	 * `undefined` means that the list cannot be read: an agent that cannot
	 * add a task cannot act on the nudge, so no nudge goes out.
	 */
	todos: TodoReminderTodo[] | undefined;
	/** The occasion of the check. */
	occasion: string;
	/**
	 * The steps of the request that is running.
	 *
	 * The steps are the work the request names. When they are known, the
	 * list is reconciled with them: an item that covers one of them
	 * silences the reminder about that step, and the steps that no item
	 * covers keep it alive. An empty list means that the steps of the
	 * request are not known, and then the list alone decides.
	 */
	requiredSteps?: string[];
	/**
	 * The request that is running.
	 *
	 * The text of the request is what the reminder names, so the agent
	 * knows which work the items belong to.
	 */
	requestText?: string;
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
 * Is the work of the request in the task list?
 *
 * One open todo is enough: the agent has recorded something, and the
 * list is not empty because of a mistake.
 *
 * The check is only the fallback. When the steps of the request are
 * known, the list is reconciled with them, because one item of the list
 * does not stand for the work that the request asks for besides it.
 */
export function workIsTracked(todos: TodoReminderTodo[] | undefined): boolean {
	return openTodos(todos).length > 0;
}

/**
 * The steps of the request that no item of the list covers.
 */
function missingSteps(
	requiredSteps: string[] | undefined,
	todos: TodoReminderTodo[] | undefined,
): string[] {
	return uncoveredSteps(requiredSteps ?? [], todos);
}

/**
 * The text of the reminder.
 *
 * The text asks; it does not instruct. It names the reason the reminder
 * is there: the task list is what survives a full context window.
 */
export function todoReminderText(
	missing: string[] = [],
	request?: string,
): string {
	return captureInstruction(request, missing);
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
	// The steps of the request decide. When they are known, the list is
	// reconciled with them: an item that covers one step does not cover
	// the other steps, and the reminder stays alive for the ones that
	// have no item.
	const required = facts.requiredSteps ?? [];
	const missing = missingSteps(required, facts.todos);
	if (required.length > 0) {
		if (missing.length === 0) {
			return {
				remind: false,
				reason: "every step of the request is in the task list",
			};
		}
	} else if (workIsTracked(facts.todos)) {
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
		reason: `the work of the request is not in the task list (${facts.occasion})`,
		text: todoReminderText(missing, facts.requestText),
	};
}
