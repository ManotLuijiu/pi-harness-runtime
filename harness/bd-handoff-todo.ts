/**
 * The handoff that the session received, and the metadata of its todos.
 *
 * A handoff is delivered as an observation: the session is told that a
 * handoff waits, and the session decides what it does with it. When the
 * session records the work of a handoff in the task list, that todo has
 * to name the handoff: the issue of the store, the handoff itself and
 * the correlation of the request.
 *
 * The metadata is the link. It is written into the todo list by the
 * harness, because the harness is the one that knows which handoff the
 * work belongs to, and because the list is durable: a todo that names the
 * handoff still names it after a restart of the session.
 *
 * The context holds the handoffs of the running request. It is a small
 * piece of state: the links of the handoffs that the session received,
 * and nothing else. It authorises nothing and it starts nothing.
 */

import {
	BD_CORRELATION_ID_METADATA_KEY,
	BD_HANDOFF_ID_METADATA_KEY,
	BD_ISSUE_ID_METADATA_KEY,
	type BdHandoffIdentity,
	type BdTodoLink,
} from "./bd-handoff-link.ts";

/**
 * The metadata of a todo that names a handoff.
 *
 * Only the identifiers that are known are written: a todo that names an
 * issue without a handoff id is still a todo of the store, and the
 * closure check reads it.
 */
export function bdTodoMetadata(
	link: BdHandoffIdentity,
): Record<string, unknown> {
	const metadata: Record<string, unknown> = {};
	if (link.bdIssueId) metadata[BD_ISSUE_ID_METADATA_KEY] = link.bdIssueId;
	if (link.handoffId) metadata[BD_HANDOFF_ID_METADATA_KEY] = link.handoffId;
	if (link.correlationId) metadata[BD_CORRELATION_ID_METADATA_KEY] = link.correlationId;
	return metadata;
}

/**
 * The name of a handoff.
 *
 * A handoff is named by its id and by the correlation of the delivery
 * that brought it. The correlation is part of the name: a handoff that
 * is delivered again is a new revision of the work, and the work of the
 * new revision was not recorded yet, even when a todo of the earlier
 * revision is in the list. A link without a correlation is named by its
 * id alone.
 */
export function bdHandoffKey(link: BdHandoffIdentity): string | null {
	const correlation =
		typeof link.correlationId === "string" && link.correlationId.trim().length > 0
			? link.correlationId.trim()
			: "";
	if (typeof link.handoffId === "string" && link.handoffId.length > 0) {
		return correlation.length > 0
			? `handoff:${link.handoffId}#${correlation}`
			: `handoff:${link.handoffId}`;
	}
	if (typeof link.bdIssueId === "string" && link.bdIssueId.length > 0) {
		return correlation.length > 0
			? `issue:${link.bdIssueId}#${correlation}`
			: `issue:${link.bdIssueId}`;
	}
	return null;
}

/**
 * The handoffs that the session received.
 *
 * The context is the memory of the delivery. A handoff belongs to the
 * session and not to the request that was running when it arrived: a
 * handoff can arrive between two requests, and the work of it runs in the
 * request that follows.
 */
export class BdHandoffContext {
	/** The links of the handoffs of the session, with the request they arrived in. */
	private links: { link: BdHandoffIdentity; generation: number }[] = [];
	/** The todos that were recorded for a handoff, with their request. */
	private todos = new Map<number, { link: BdHandoffIdentity; generation: number }>();

	/**
	 * A handoff was delivered into the session.
	 *
	 * A handoff that is known already keeps one link, and the link is the
	 * one of the delivery that happened now: the runtime delivers a
	 * handoff again when its revision grows, and the correlation of the
	 * new delivery is the one that counts.
	 *
	 * The request of the delivery is kept with the link: a handoff that
	 * arrived in a request is the work of that request, even when the
	 * text of the request names no issue.
	 */
	add(link: BdHandoffIdentity, generation = 0): void {
		if (!link.bdIssueId && !link.handoffId && !link.correlationId) return;
		const known = this.links.findIndex((entry) =>
			BdHandoffContext.sameHandoff(entry.link, link),
		);
		if (known < 0) {
			this.links.push({ link: { ...link }, generation });
		} else {
			// A new revision of a handoff is a new handoff: the link of the
			// delivery keeps the correlation of the delivery that happened
			// now, and not the correlation of an earlier one.
			this.links[known] = { link: { ...link }, generation };
		}
	}

	/**
	 * The handoffs that arrived in a request.
	 *
	 * A handoff that arrived in the running request is the work of that
	 * request: the harness told the agent about it in that request, so
	 * the request does not have to name the issue itself.
	 */
	arrivedIn(generation: number): BdHandoffIdentity[] {
		return this.links
			.filter((entry) => entry.generation === generation)
			.map((entry) => ({ ...entry.link }));
	}

	/**
	 * The handoffs whose work was not recorded yet.
	 *
	 * A handoff whose todo was recorded is work that the task list holds,
	 * and everything that follows it is recorded with the plain tool. A
	 * handoff without a todo is work that is still open: the request that
	 * records that work has to name the issue it belongs to, otherwise the
	 * todo names no issue and the closure check cannot end the work of an
	 * issue that was closed.
	 */
	pending(): BdHandoffIdentity[] {
		const recorded = new Set<string>();
		for (const entry of this.todos.values()) {
			const key = BdHandoffContext.keyOf(entry.link);
			if (key !== null) recorded.add(key);
		}
		return this.links
			.filter((entry) => {
				const key = BdHandoffContext.keyOf(entry.link);
				return key !== null && !recorded.has(key);
			})
			.map((entry) => ({ ...entry.link }));
	}

	/**
	 * The name of a handoff.
	 *
	 * A handoff is named by its id and by the correlation of the delivery
	 * that brought it. The correlation is part of the name: a handoff
	 * that is delivered again is a new revision of the work, and the
	 * work of the new revision was not recorded yet, even when a todo of
	 * the earlier revision is in the list. A link without a correlation is
	 * named by its id alone.
	 */
	private static keyOf(link: BdHandoffIdentity): string | null {
		return bdHandoffKey(link);
	}

	/**
	 * Do two links name the same handoff?
	 *
	 * A handoff is named by its id. A link without a handoff id is named by
	 * its issue, and only by its issue.
	 */
	private static sameHandoff(a: BdHandoffIdentity, b: BdHandoffIdentity): boolean {
		if (b.handoffId !== undefined && a.handoffId === b.handoffId) return true;
		return (
			b.bdIssueId !== undefined && a.bdIssueId === b.bdIssueId && a.handoffId === undefined
		);
	}

	/**
	 * The links of the handoffs of the running request.
	 */
	all(): BdHandoffIdentity[] {
		return this.links.map((entry) => ({ ...entry.link }));
	}

	/**
	 * A todo was recorded for a handoff.
	 *
	 * The todo of a handoff is the evidence that the work belongs to it.
	 * A todo of an earlier request is linked to the handoff afterwards:
	 * the link of the todo is then the only evidence that the todo is
	 * work of this handoff, because the scope of a request is decided by
	 * the status and the subject of its todos.
	 *
	 * The request is remembered with the todo: only the todos of the
	 * running request belong to the work of the running request.
	 */
	noteTodo(todoId: number, link: BdHandoffIdentity, generation: number): void {
		if (!Number.isInteger(todoId) || todoId < 1) return;
		this.todos.set(todoId, { link: { ...link }, generation });
	}

	/**
	 * The links of the todos that the running request recorded.
	 */
	linksOfGeneration(generation: number): BdTodoLink[] {
		const links: BdTodoLink[] = [];
		for (const [todoId, entry] of this.todos.entries()) {
			if (entry.generation !== generation) continue;
			links.push({ ...entry.link, todoId });
		}
		return links;
	}

	/**
	 * The link of one issue of the store.
	 */
	linkOfIssue(bdIssueId: string): BdHandoffIdentity | null {
		const wanted = bdIssueId.trim();
		if (wanted.length === 0) return null;
		for (const entry of this.links) {
			if (entry.link.bdIssueId === wanted) return { ...entry.link };
		}
		return null;
	}

	/**
	 * The link of one handoff.
	 */
	linkOfHandoff(handoffId: string): BdHandoffIdentity | null {
		const wanted = handoffId.trim();
		if (wanted.length === 0) return null;
		for (const entry of this.links) {
			if (entry.link.handoffId === wanted) return { ...entry.link };
		}
		return null;
	}

	/**
	 * The session ended: the handoffs of that session are over.
	 */
	clear(): void {
		this.links = [];
		this.todos.clear();
	}

	/**
	 * How many handoffs the running request received.
	 */
	get size(): number {
		return this.links.length;
	}
}
