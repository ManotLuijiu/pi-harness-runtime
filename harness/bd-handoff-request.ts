/**
 * The handoff that a request works on.
 *
 * The session receives handoffs between requests, and the work of a
 * handoff runs in a request. The harness has to answer one question
 * about a request: "which handoff does this request work on?"
 *
 * The answer decides two things:
 *
 * - the tool that records the work of the request. The todo of the work of
 *   a handoff has to carry the identifiers of the handoff, and only the
 *   tool of the handoff writes them.
 * - the evidence of the checkpoints. The identifiers of a checkpoint say
 *   which work it belongs to, and a checkpoint of a request that works on
 *   no handoff carries none.
 *
 * The question has one answer for the whole session, so the intake, the
 * reminder and the checkpoint ask it the same way. A request that names
 * the plain tool while the advisory of the same request names the tool of
 * the handoff would leave the choice to the agent, and the todo of the
 * work of the handoff would be written without its link.
 *
 * The work of a handoff belongs to one request:
 *
 * - a handoff that arrives while a request is running belongs to that
 *   request. The advisory of the handoff continues the work of the request
 *   that is running.
 * - a handoff that arrives between two requests belongs to the request
 *   that follows. The run of the agent has settled, and the turn that the
 *   advisory starts is no work of a request of the human.
 *
 * A handoff that is known by the text of the request belongs to that
 * request as well: the human asks for the work of a handoff of an earlier
 * request by name.
 */

import type { BdHandoffIdentity, BdTodoLink } from "./bd-handoff-link.ts";
import { bdHandoffKey, type BdHandoffContext } from "./bd-handoff-todo.ts";

/**
 * The name of the plain tool of the task list.
 */
export const PLAIN_TODO_TOOL = "todo";

/**
 * The state of the request that is running.
 */
export interface HandoffRequestState {
	/** The generation of the request that is running. */
	generation: number;
	/** Did a request of the human begin? */
	requestBegan: boolean;
	/** Did the agent answer the request? */
	requestAnswered: boolean;
}

/**
 * The generation of the request that the work of a handoff runs in.
 *
 * The advisory of a handoff continues the request that is running, so the
 * work of a handoff that arrives during a request belongs to that request.
 * A handoff that arrives after the agent answered belongs to the request
 * that follows: the turn that the advisory starts is no work of a request
 * of the human.
 */
export function handoffWorkGeneration(state: HandoffRequestState): number {
	if (state.requestBegan && !state.requestAnswered) return state.generation;
	return state.generation + 1;
}

/**
 * The name of a handoff.
 *
 * The name is the id of the handoff and the correlation of the delivery
 * that brought it. A link without a correlation is named by its id alone.
 */
function keyOf(link: BdHandoffIdentity): string | null {
	return bdHandoffKey(link);
}

/**
 * Does the text of a request name the issue of a handoff?
 *
 * The name of the issue is looked for in the text of the request. A
 * request that names no issue is a request that is not about a handoff.
 */
export function namesIssue(
	text: string,
	bdIssueId: string | undefined,
): boolean {
	if (typeof text !== "string" || text.trim().length === 0) return false;
	const id = typeof bdIssueId === "string" ? bdIssueId.trim() : "";
	if (id.length === 0) return false;
	return text.includes(id);
}

/**
 * The handoffs that a request works on.
 *
 * The handoff is the work of the request when the request was told about
 * it, when the request recorded its todo, or when the text of the request
 * names its issue.
 *
 * A handoff of another request is not the work of this one: a todo of
 * this request that names the issue of that handoff would link the work of
 * this request to the store.
 */
export function handoffsOfRequest(
	context: BdHandoffContext,
	text: string,
	generation: number,
): BdHandoffIdentity[] {
	const found: BdHandoffIdentity[] = [];
	const seen = new Set<string>();
	const push = (link: BdHandoffIdentity): void => {
		const key = keyOf(link);
		if (key === null || seen.has(key)) return;
		seen.add(key);
		found.push({ ...link });
	};
	// The handoffs the request was told about: the advisory of the handoff
	// was dispatched into this request, so the request does not have to
	// name the issue itself.
	for (const link of context.arrivedIn(generation)) push(link);
	// The handoffs whose todo this request recorded.
	for (const link of context.linksOfGeneration(generation)) push(link);
	// The handoffs the text of the request names: the human asks for the
	// work of a handoff of an earlier request by name.
	for (const link of context.all()) {
		if (namesIssue(text, link.bdIssueId)) push(link);
	}
	return found;
}

/**
 * The handoffs whose work a request has still to record.
 *
 * A handoff whose todo is in the list is work that the list holds: the
 * request does not have to name it any more, and everything that follows
 * it is recorded with the plain tool.
 */
export function openHandoffsOfRequest(
	context: BdHandoffContext,
	text: string,
	generation: number,
): BdHandoffIdentity[] {
	const open = new Set<string>();
	for (const link of context.pending()) {
		const key = keyOf(link);
		if (key !== null) open.add(key);
	}
	return handoffsOfRequest(context, text, generation).filter((link) => {
		const key = keyOf(link);
		return key !== null && open.has(key);
	});
}

/**
 * The link of the handoff that a request works on.
 *
 * The todos of the running request are the evidence of its work: a todo
 * that names a handoff says which handoff the request works on, even when
 * the todo was linked in an earlier request. The link of the request is
 * the first of these that is known:
 *
 * 1. the todos of the running request,
 * 2. the todos the request linked itself,
 * 3. the handoffs the request was told about,
 * 4. the handoffs the text of the request names.
 *
 * The last of the third and the fourth wins: the human named that issue
 * in the request, and a name of the human is a stronger evidence than an
 * advisory of the harness.
 *
 * A request that works on no handoff has no link: the checkpoint of that
 * request carries no identifier of the store.
 */
export function handoffLinkOfRequest(
	context: BdHandoffContext,
	text: string,
	generation: number,
	scopeLinks: readonly BdTodoLink[] = [],
): BdHandoffIdentity | null {
	for (const link of scopeLinks) {
		if (keyOf(link) !== null) return { ...link };
	}
	for (const link of context.linksOfGeneration(generation)) {
		return { ...link };
	}
	const handoffs = handoffsOfRequest(context, text, generation);
	const last = handoffs.at(-1);
	return last ? { ...last } : null;
}

/**
 * The tool that records the work of a request.
 *
 * The work of a handoff is recorded with the tool of the handoff: the
 * plain tool knows nothing of the handoff, and the todo of the work would
 * name no issue at all. A request that works on no handoff is recorded
 * with the plain tool.
 */
export function todoToolOf(
	handoffs: readonly BdHandoffIdentity[],
	handoffToolName: string,
): string {
	return handoffs.length > 0 ? handoffToolName : PLAIN_TODO_TOOL;
}
