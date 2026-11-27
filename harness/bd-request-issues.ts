/**
 * The reconciliation of the issues of the backlog that a request authorizes.
 *
 * The backlog is not the work of a request: an issue becomes work only when
 * the request authorizes it. The reconciliation compares the ids the request
 * authorized with the todos of the request and with the backlog, so the
 * harness knows which authorized work is still outstanding and which one is
 * already represented by a todo.
 *
 * The reconciliation authorizes nothing. An issue that nobody authorized
 * stays a candidate: it may be proposed, but it is never executed as the
 * work of the request.
 *
 * The link between an issue and a todo is carried by the metadata of the
 * todo (`bdIssueId`), so it survives a restart of the session.
 */

import { BD_ISSUE_ID_METADATA_KEY } from "./bd-handoff-link.ts";
import type { BdScanResult } from "./bd-discovery.ts";

/** The part of a todo the reconciliation needs. */
export interface RequestIssueTodo {
	id?: number | string;
	status?: string;
	metadata?: Record<string, unknown> | null;
}

/** The authorized issues of a request, and how they stand. */
export interface RequestIssueReconciliation {
	/** The ids the request authorizes (deduplicated). */
	authorized: string[];
	/** The authorized issues that a todo of the request carries. */
	linked: { id: string; todoIds: string[] }[];
	/**
	 * The authorized issues that are still outstanding.
	 *
	 * An authorized issue is outstanding when the backlog reports it as open
	 * (or does not know it) and no todo of the request carries it. The work
	 * was authorized, so it remains work until it is done.
	 */
	outstanding: string[];
	/** The authorized issues the backlog reports as closed. */
	closed: string[];
	/** Is the backlog readable? */
	available: boolean;
	/** Why the backlog is not readable, when it is not. */
	reason?: string;
}

/** The statuses of an issue that mean it is done. */
const CLOSED_STATUSES = new Set(["closed", "done"]);

/**
 * The issue a todo carries.
 *
 * The metadata is the link: a todo without it belongs to no issue, and a
 * todo of another issue is not the work of this one.
 */
export function issueIdOf(
	todo: RequestIssueTodo | null | undefined,
): string | undefined {
	const metadata = todo?.metadata;
	if (!metadata || typeof metadata !== "object") return undefined;
	const value = (metadata as Record<string, unknown>)[BD_ISSUE_ID_METADATA_KEY];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The ids of the request, without the empty ones and without duplicates.
 */
function normalizeIds(ids: readonly string[] | undefined): string[] {
	const seen = new Set<string>();
	for (const id of ids ?? []) {
		const trimmed = (id ?? "").trim();
		if (!trimmed) continue;
		seen.add(trimmed);
	}
	return [...seen];
}

/**
 * Is the issue of the backlog done?
 *
 * An issue that the backlog does not know is not done: an unknown state is
 * never a completion.
 */
function isClosed(issue: { status?: string } | undefined): boolean {
	if (!issue) return false;
	return CLOSED_STATUSES.has((issue.status ?? "").trim().toLowerCase());
}

/**
 * The reconciliation of the authorized issues of a request.
 *
 * The result names what the request authorized, what is already linked to a
 * todo of the request, what is still outstanding and what the backlog
 * reports as closed. A backlog that cannot be read is reported as
 * unavailable: the outstanding work is then unknown and not empty.
 */
export function reconcileRequestIssues(input: {
	/** The ids the request authorizes. */
	authorizedIds?: readonly string[];
	/** The todos of the request. */
	items?: readonly RequestIssueTodo[] | null;
	/** The backlog. */
	scan?: BdScanResult | null;
}): RequestIssueReconciliation {
	const authorized = normalizeIds(input.authorizedIds);
	const linked = new Map<string, string[]>();
	for (const todo of input.items ?? []) {
		const issueId = issueIdOf(todo);
		if (!issueId || !authorized.includes(issueId)) continue;
		const todoIds = linked.get(issueId) ?? [];
		// A todo is linked once: the same todo is never counted twice.
		const todoId = todo.id === undefined ? "" : String(todo.id);
		if (!todoIds.includes(todoId)) todoIds.push(todoId);
		linked.set(issueId, todoIds);
	}

	if (authorized.length === 0) {
		return {
			authorized,
			linked: [],
			outstanding: [],
			closed: [],
			available: input.scan?.available ?? true,
			reason: input.scan?.reason,
		};
	}

	const scan = input.scan;
	if (!scan || !scan.available) {
		// The backlog could not be read: the state of the authorized work is
		// unknown, and an unknown state is not a finished work.
		return {
			authorized,
			linked: [...linked].map(([id, todoIds]) => ({ id, todoIds })),
			outstanding: authorized.filter((id) => !linked.has(id)),
			closed: [],
			available: false,
			reason: scan?.reason ?? "the backlog could not be read",
		};
	}

	const byId = new Map(scan.issues.map((issue) => [issue.id, issue]));
	const outstanding: string[] = [];
	const closed: string[] = [];
	for (const id of authorized) {
		if (linked.has(id)) continue;
		const issue = byId.get(id);
		if (isClosed(issue)) {
			closed.push(id);
			continue;
		}
		// The issue is open, or the backlog does not know it. Either way the
		// authorized work is not done.
		outstanding.push(id);
	}
	return {
		authorized,
		linked: [...linked].map(([id, todoIds]) => ({ id, todoIds })),
		outstanding,
		closed,
		available: true,
	};
}

/**
 * The issues that the requests authorize.
 *
 * The authorization belongs to the request that got it: a new request does
 * not inherit the issues of the old one, and the issues of a request are
 * forgotten when the request is over.
 */
export class RequestIssueTracker {
	private readonly authorized = new Map<number, string[]>();

	/**
	 * The request authorizes these issues.
	 *
	 * The ids are added to the ones the request already authorizes: the
	 * human may approve a second group of the backlog while the first one
	 * is still running.
	 */
	authorize(generation: number, ids: readonly string[]): string[] {
		const current = this.authorized.get(generation) ?? [];
		const merged = normalizeIds([...current, ...ids]);
		this.authorized.set(generation, merged);
		return merged;
	}

	/** The issues the request authorizes. */
	authorizedFor(generation: number): string[] {
		return [...(this.authorized.get(generation) ?? [])];
	}

	/** The request is over: its issues are history. */
	forget(generation: number): void {
		this.authorized.delete(generation);
	}

	/** The request is over: every issue is history. */
	clear(): void {
		this.authorized.clear();
	}
}
