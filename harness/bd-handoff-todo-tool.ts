/**
 * The tool that records the work of a handoff in the task list.
 *
 * The todo list of the session is the list of the steps of the request.
 * A step that belongs to a handoff has to name that handoff, otherwise
 * nobody can tell afterwards which issue of the store the step belongs
 * to, and a work that was finished elsewhere would be started again.
 *
 * The harness writes the link. The agent says which issue the work
 * belongs to and what the step is, and the harness adds the identifiers
 * of the handoff and calls the real todo tool: the list stays the list
 * of the todo extension, the metadata is part of it, and it survives a
 * restart of the session.
 *
 * The tool is narrow on purpose:
 *
 * - It only records a handoff that this session received. A todo of
 *   another session is not linked here.
 * - A todo that is linked during the running request belongs to the work
 *   of that request: the closure of the work follows the todos of the
 *   running request, and the link of the todo is what says that it is
 *   work of a handoff.
 * - It records evidence and it starts nothing. The link is a fact about
 *   the todo, not an approval of the work.
 */

import { Type } from "typebox";
import {
	defineTool,
	type ExtensionAPI,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { bdTodoMetadata, type BdHandoffContext } from "./bd-handoff-todo.ts";
import type { BdHandoffIdentity } from "./bd-handoff-link.ts";

/**
 * The name of the tool.
 */
export const BD_HANDOFF_TODO_TOOL = "bd_handoff_todo";

/**
 * The result of a nested call of another tool.
 */
interface NestedToolOutcome {
	/** Did the call fail? */
	isError: boolean;
	/** The result of the call. */
	result?: { details?: unknown };
}

/**
 * The part of the context that can call another tool.
 *
 * Pi runs one tool from inside another tool since 1.4. The versions of Pi
 * that this repository was written against do not know that call, so it is
 * read from the context when the tool runs: a Pi that cannot do it says
 * so, instead of failing in a way nobody understands.
 */
interface NestedToolCaller {
	executeTool?: (
		name: string,
		args: unknown,
		options?: { signal?: AbortSignal },
	) => Promise<NestedToolOutcome>;
}

/**
 * The options of the tool.
 */
export interface BdHandoffTodoToolOptions {
	/**
	 * The handoffs that this session received.
	 *
	 * There is no context when no handoff was delivered: the tool then
	 * says that it has nothing to link, instead of linking a todo to
	 * nothing.
	 */
	context: () => BdHandoffContext | null;
	/**
	 * The durable record of the handoff is told about the todo.
	 *
	 * The record of the store keeps the todos of a handoff, so a reader
	 * of the store can see which work belonged to it.
	 */
	onLinked?: (link: BdHandoffIdentity, todoIds: number[]) => void;
}

/**
 * The parameters of the tool.
 */
const parameters = Type.Object({
	issueId: Type.String({
		description:
			"The exact id of the issue of the store that the work belongs to, as it was named in the handoff.",
	}),
	subject: Type.String({
		description:
			"The subject of the todo, in the imperative: what the step is.",
	}),
	description: Type.Optional(
		Type.String({
			description: "What the step is and how it is checked.",
		}),
	),
	todoId: Type.Optional(
		Type.Number({
			description:
				"The id of an existing todo of the list. The todo is linked to the handoff instead of a new one being created.",
		}),
	),
});

/**
 * Does the todo carry the link of the handoff?
 *
 * The metadata of the todo names the handoff. A todo without that
 * metadata is not a todo of this handoff, whatever the call did.
 */
export function carriesLink(task: unknown, link: BdHandoffIdentity): boolean {
	if (!task || typeof task !== "object") return false;
	const metadata = (task as { metadata?: unknown }).metadata;
	if (!metadata || typeof metadata !== "object") return false;
	const named = metadata as Record<string, unknown>;
	// A link that names nothing proves nothing: a todo with any metadata
	// at all is not a todo of this handoff.
	if (
		link.handoffId === undefined &&
		link.bdIssueId === undefined &&
		link.correlationId === undefined
	) {
		return false;
	}
	if (link.handoffId !== undefined && named.handoffId !== link.handoffId) {
		return false;
	}
	if (link.bdIssueId !== undefined && named.bdIssueId !== link.bdIssueId) {
		return false;
	}
	// The correlation is part of the name of the link: a todo of another
	// delivery of the same handoff is not a todo of this delivery.
	if (link.correlationId !== undefined && named.correlationId !== link.correlationId) {
		return false;
	}
	return true;
}

/**
 * The id of the todo that the call recorded.
 *
 * A create gives the new todo the id that the list hands out next, so
 * the id of the created todo is the one before the next id of the list.
 * An update keeps the id of the todo it changed. Only that todo is
 * reported: a todo of an earlier call that carries the same link is not
 * a todo of this call.
 *
 * The id alone does not prove that the call wrote the todo: a list that
 * refuses a create without saying so leaves the next id where it was,
 * and the todo that sits there is the todo of an earlier call. The
 * subject of the call is the proof: the todo that carries the subject of
 * this call is the todo of this call.
 */
export function recordedTodoId(
	details: unknown,
	link: BdHandoffIdentity,
	todoId?: number,
	expected?: { subject?: string },
): number | null {
	if (!details || typeof details !== "object") return null;
	const tasks = (details as { tasks?: unknown }).tasks;
	if (!Array.isArray(tasks)) return null;
	const wanted = wantedTodoId(details, todoId);
	if (wanted === null || wanted < 1) return null;
	for (const task of tasks) {
		if (!task || typeof task !== "object") continue;
		if ((task as { id?: unknown }).id !== wanted) continue;
		if (!carriesLink(task, link)) continue;
		if (expected?.subject !== undefined && !carriesSubject(task, expected.subject)) {
			// The todo at that id is a todo of an earlier call: it carries
			// the link of the handoff, but it is not the todo that this
			// call wrote.
			continue;
		}
		return wanted;
	}
	return null;
}

/**
 * The id of the todo that the call wrote.
 *
 * An update names the todo it changes. A create takes the id that the
 * list hands out next, so the todo it wrote is the one before the next
 * id of the list.
 */
function wantedTodoId(details: unknown, todoId?: number): number | null {
	if (typeof todoId === "number") return todoId;
	const nextId = (details as { nextId?: unknown }).nextId;
	if (typeof nextId !== "number") return null;
	return nextId - 1;
}

/**
 * Does the todo carry the subject of the call?
 *
 * The subject of the call is written into the todo by the list, so a
 * todo that carries it is the todo of that call. A todo without a
 * subject carries nothing: the list always writes one.
 */
function carriesSubject(task: unknown, subject: string): boolean {
	const named = (task as { subject?: unknown }).subject;
	if (typeof named !== "string") return false;
	return named.trim() === subject.trim();
}

/**
 * The error of a call of the todo tool, when the list refused it.
 *
 * The tool of the list does not throw and does not mark the call as an
 * error: the refusal is in the details of the result.
 */
export function todoErrorOf(details: unknown): string | null {
	if (!details || typeof details !== "object") return null;
	const error = (details as { error?: unknown }).error;
	if (typeof error === "string" && error.trim().length > 0) return error.trim();
	return null;
}

/**
 * The answer of a call that recorded nothing.
 */
function failure(text: string): {
	content: { type: "text"; text: string }[];
	details: { recorded: false; reason: string };
} {
	return {
		content: [{ type: "text", text }],
		details: { recorded: false, reason: text },
	};
}

/**
 * The tool that records the work of a handoff.
 *
 * The tool never throws: a call that cannot be recorded is reported as
 * a failure of the record, and the agent continues.
 */
export function bdHandoffTodoTool(
	options: BdHandoffTodoToolOptions,
): ToolDefinition<typeof parameters> {
	return defineTool({
		name: BD_HANDOFF_TODO_TOOL,
		label: "Handoff todo",
		description:
			"Record a step of the work of a handoff in the task list (todo) and link it to the handoff. " +
			"Give the exact id of the issue of the store that the work belongs to, as the handoff named it. " +
			"The harness adds the identifiers of the handoff to the todo, so the step stays linked to the issue after a restart. " +
			"It records a step: it does not start the work, it does not change the issue and it does not authorise anything.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const context = options.context();
			if (!context) {
				return failure(
					"No handoff was delivered to this session, so there is nothing to link a todo to.",
				);
			}
			const link = context.linkOfIssue(params.issueId);
			if (!link) {
				return failure(
					`The issue ${params.issueId} was not delivered to this session, so its todo cannot be linked.`,
				);
			}
			if (typeof params.subject !== "string" || params.subject.trim().length === 0) {
				return failure(
					"A todo that is linked to a handoff needs a subject, so the step is readable on its own.",
				);
			}
			// SAFETY: the context of a tool call carries `executeTool` when
			// the running Pi knows that call. The types of this repository
			// are older than that Pi, so the call is read from the context
			// instead of from a type that does not exist yet. The call
			// above checked that the function is really there.
			const caller = ctx as unknown as NestedToolCaller;
			if (typeof caller.executeTool !== "function") {
				return failure(
					"This version of Pi cannot call the todo tool from inside a tool, so the todo was not recorded.",
				);
			}
			const metadata = bdTodoMetadata(link);
			const update = typeof params.todoId === "number";
			// The description is left out when the model did not write one:
			// a key that is there and empty is not the same thing as a key
			// that is not there.
			const body: Record<string, unknown> = {
				subject: params.subject,
				metadata,
			};
			if (typeof params.description === "string") {
				body.description = params.description;
			}
			let outcome: NestedToolOutcome;
			try {
				outcome = await caller.executeTool(
					"todo",
					update
						? {
								action: "update",
								id: params.todoId,
								...body,
							}
						: {
								action: "create",
								...body,
							},
				);
			} catch (error) {
				return failure(
					`The todo tool could not be called: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			if (outcome.isError) {
				return failure(
					"The todo tool refused the call, so the todo was not recorded.",
				);
			}
			const details = outcome.result?.details;
			const refusal = todoErrorOf(details);
			if (refusal) {
				return failure(
					`The todo tool refused the call: ${refusal}`,
				);
			}
			const id = recordedTodoId(details, link, params.todoId, {
				subject: params.subject,
			});
			if (id === null) {
				// The list did not report the todo that was written. The
				// tool does not know that the todo is there, so it does
				// not claim that it is: a report that cannot be proved is
				// not a report of a success.
				return failure(
					`The todo tool did not report the todo that was written, so the link to ${params.issueId} could not be proved.`,
				);
			}
			try {
				options.onLinked?.(link, [id]);
			} catch {
				// The record of the store is a copy: a failure to write it
				// does not undo the todo that was written.
			}
			return {
				content: [
					{
						type: "text",
						text: `The todo was recorded and linked to ${params.issueId}. It is todo #${id}.`,
					},
				],
				details: { recorded: true, todoIds: [id], metadata },
			};
		},
	});
}

/**
 * Register the tool of the handoff todo.
 */
export function registerBdHandoffTodoTool(
	pi: ExtensionAPI,
	options: BdHandoffTodoToolOptions,
): void {
	pi.registerTool(bdHandoffTodoTool(options));
}
