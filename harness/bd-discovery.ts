/**
 * The bounded discovery of the backlog.
 *
 * The backlog of the issue tracker is not the work of the request. It is a
 * place where related work may live, and the discovery of that work has to
 * be bounded in every direction:
 *
 * - The scan happens at meaningful boundaries only, with a cooldown and one
 *   read in flight. A scan is not a poll, and it never runs per token.
 * - The relevance of an issue is decided before the small batch cap is
 *   applied, so a cap never hides the relevant issue behind the unrelated
 *   ones.
 * - A read that fails is "unavailable", not "empty". The user can tell
 *   "nothing is relevant" from "nothing was read".
 * - A scan never starts a turn of the agent. The discovery is metadata: it
 *   informs a decision, it does not make one.
 */

/** One issue of the backlog, as the discovery sees it. */
export interface BdIssue {
	id: string;
	title: string;
	status?: string;
	priority?: number;
	issueType?: string;
	assignee?: string;
	description?: string;
	notes?: string;
	/** The ids of the issues that block this one. */
	blockedBy?: string[];
	/** The ids of the issues that depend on this one. */
	blocks?: string[];
}

/** The result of one read of the backlog. */
export interface BdScanResult {
	/** Was the backlog readable at all? */
	available: boolean;
	/** The issues that were read. */
	issues: BdIssue[];
	/** Why the backlog is not readable. */
	reason?: string;
	/** When the read happened. */
	scannedAt: number;
}

/** Why an issue is not part of the work of the request. */
export type BdExclusionReason =
	| "closed"
	| "deferred"
	| "blocked"
	| "claimed"
	| "unrelated";

/** Why an issue was taken into account. */
export type BdRelevanceReason =
	| "authorized"
	| "named"
	| "dependency"
	| "related";

/** One issue that the discovery took into account. */
export interface BdRelevantIssue {
	issue: BdIssue;
	/** Why the issue is relevant. */
	reason: BdRelevanceReason;
	/**
	 * Is the issue authorized to be executed?
	 *
	 * Only an issue that the request authorizes may be executed. A title
	 * that matches contributes a candidate, never an authorization.
	 */
	authorized: boolean;
}

/** One issue that the discovery left out, and why. */
export interface BdExcludedIssue {
	id: string;
	title: string;
	reason: BdExclusionReason;
}

/** The outcome of a discovery. */
export interface BdDiscoveryResult {
	/** The issues that are relevant for the request. */
	relevant: BdRelevantIssue[];
	/** The issues that were left out, with the reason. */
	excluded: BdExcludedIssue[];
	/** Was the backlog readable? */
	available: boolean;
	/** Why the backlog is not readable, when it is not. */
	reason?: string;
	/** When the read happened. */
	scannedAt: number;
	/** How many issues were read. */
	read: number;
	/** How many issues were considered relevant. */
	relevantCount: number;
	/** How many issues are ready to be executed (authorized and not blocked). */
	readyCount: number;
}

/** The context of the relevance of the issues. */
export interface BdRelevanceContext {
	/**
	 * The ids that the request authorizes.
	 *
	 * An issue of this list is work of the request: it is linked to the
	 * todos of the request and continued there.
	 */
	authorizedIds?: readonly string[];
	/**
	 * The ids that the request names, without authorizing them.
	 *
	 * A named issue is a candidate: the human mentioned it, so it belongs
	 * to the conversation, but it is not work until it is authorized.
	 */
	namedIds?: readonly string[];
	/**
	 * The ids that are related to the authorized work (parent, child,
	 * dependency).
	 */
	relatedIds?: readonly string[];
	/** The words of the request. */
	requestText?: string;
	/** The paths that the request touches. */
	paths?: readonly string[];
	/** The status of the issue is closed. */
	isClosed?: (issue: BdIssue) => boolean;
	/** The issue is deferred. */
	isDeferred?: (issue: BdIssue) => boolean;
	/** The issue is blocked by another issue. */
	isBlocked?: (issue: BdIssue) => boolean;
	/**
	 * The issue is claimed by another agent.
	 *
	 * The work of another agent is not imported: it would be executed
	 * twice. Without a known actor nothing is claimed: the harness does
	 * not guess who owns an issue.
	 */
	isClaimed?: (issue: BdIssue) => boolean;
	/**
	 * The actor of this session.
	 *
	 * An issue that is assigned to another actor is claimed work. An issue
	 * that is assigned to this actor is the work of this session.
	 */
	actor?: string;
}

/** The statuses that mean the issue is closed. */
const CLOSED_STATUSES = new Set(["closed", "done"]);

/** The statuses that mean the issue is deferred. */
const DEFERRED_STATUSES = new Set(["deferred"]);

/** The default number of issues that the discovery returns. */
export const DEFAULT_DISCOVERY_LIMIT = 10;

/**
 * The words of the request, without the ones that say nothing.
 */
function requestTokens(requestText: string | undefined): string[] {
	if (!requestText) return [];
	return requestText
		.toLowerCase()
		.split(/[^a-z0-9_.-]+/i)
		.map((token) => token.trim())
		.filter((token) => token.length >= 4);
}

/**
 * The predicates of the state of an issue.
 *
 * The predicates are resolved once per discovery, so the loop over the
 * issues stays simple.
 */
interface IssuePredicates {
	isClosed: (issue: BdIssue) => boolean;
	isDeferred: (issue: BdIssue) => boolean;
	isBlocked: (issue: BdIssue) => boolean;
	isClaimed: (issue: BdIssue) => boolean;
}

/** The predicates of the state of an issue, from the context. */
function issuePredicates(context: BdRelevanceContext): IssuePredicates {
	const actor = (context.actor ?? "").trim().toLowerCase();
	return {
		isClosed:
			context.isClosed ??
			((issue: BdIssue) =>
				CLOSED_STATUSES.has((issue.status ?? "").toLowerCase())),
		isDeferred:
			context.isDeferred ??
			((issue: BdIssue) =>
				DEFERRED_STATUSES.has((issue.status ?? "").toLowerCase())),
		isBlocked:
			context.isBlocked ??
			((issue: BdIssue) =>
				(issue.blockedBy ?? []).length > 0 ||
				(issue.status ?? "").toLowerCase() === "blocked"),
		isClaimed:
			context.isClaimed ??
			((issue: BdIssue) => {
				const assignee = (issue.assignee ?? "").trim().toLowerCase();
				if (!actor || !assignee) return false;
				return assignee !== actor;
			}),
	};
}

/**
 * Why the issue is not work of the request, or null when it is work.
 */
function exclusionReason(
	issue: BdIssue,
	predicates: IssuePredicates,
): BdExclusionReason | null {
	if (predicates.isClosed(issue)) return "closed";
	if (predicates.isDeferred(issue)) return "deferred";
	if (predicates.isClaimed(issue)) return "claimed";
	if (predicates.isBlocked(issue)) return "blocked";
	return null;
}

/**
 * Why the issue is relevant, or null when it is not.
 *
 * A title that matches contributes a candidate. It is never an
 * authorization: the execution of an issue needs the request to authorize
 * it.
 */
function relevanceReason(
	issue: BdIssue,
	sets: { authorized: Set<string>; named: Set<string>; related: Set<string> },
	tokens: readonly string[],
	paths: readonly string[],
): BdRelevanceReason | null {
	if (sets.authorized.has(issue.id)) return "authorized";
	if (sets.named.has(issue.id)) return "named";
	if (sets.related.has(issue.id)) return "dependency";
	if (tokens.length === 0 && paths.length === 0) return null;
	const text = `${issue.title ?? ""} ${issue.description ?? ""}`.toLowerCase();
	const matchesPath = paths.some(
		(path) => path.length > 0 && text.includes(path),
	);
	if (matchesPath) return "related";
	const matchesToken = tokens.some((token) => text.includes(token));
	return matchesToken ? "related" : null;
}

/**
 * The relevance of the issues, from a read of the backlog.
 *
 * The filter runs before the cap: the cap bounds what the user sees, not
 * what the harness looks at.
 */
export function selectRelevantIssues(
	scan: BdScanResult,
	context: BdRelevanceContext = {},
	limit: number = DEFAULT_DISCOVERY_LIMIT,
): BdDiscoveryResult {
	const excluded: BdExcludedIssue[] = [];
	const relevant: BdRelevantIssue[] = [];
	if (!scan.available) {
		return {
			relevant,
			excluded,
			available: false,
			reason: scan.reason ?? "the backlog could not be read",
			scannedAt: scan.scannedAt,
			read: 0,
			relevantCount: 0,
			readyCount: 0,
		};
	}
	const sets = {
		authorized: new Set(context.authorizedIds ?? []),
		named: new Set(context.namedIds ?? []),
		related: new Set(context.relatedIds ?? []),
	};
	const tokens = requestTokens(context.requestText);
	const paths = (context.paths ?? []).map((path) => path.toLowerCase());
	const predicates = issuePredicates(context);

	for (const issue of scan.issues) {
		if (!issue?.id) continue;
		const exclusion = exclusionReason(issue, predicates);
		if (exclusion) {
			excluded.push({ id: issue.id, title: issue.title, reason: exclusion });
			continue;
		}
		const reason = relevanceReason(issue, sets, tokens, paths);
		if (!reason) {
			excluded.push({ id: issue.id, title: issue.title, reason: "unrelated" });
			continue;
		}
		relevant.push({ issue, reason, authorized: reason === "authorized" });
	}
	const capped = relevant.slice(0, Math.max(0, limit));
	return {
		relevant: capped,
		excluded,
		available: true,
		scannedAt: scan.scannedAt,
		read: scan.issues.length,
		relevantCount: relevant.length,
		readyCount: capped.filter((entry) => entry.authorized).length,
	};
}

/** The options of the discovery. */
export interface BdDiscoveryOptions {
	/** Reads the backlog. */
	read: () => Promise<BdScanResult>;
	/** How long a read is reused, in milliseconds. */
	ttlMs?: number;
	/** The number of the request that is running. */
	generation?: () => number;
	/** The limit of the issues that are returned. */
	limit?: number;
	/** The clock. */
	now?: () => number;
}

/**
 * The bounded discovery of the backlog.
 *
 * The cache is keyed by the request: a new request does not inherit the
 * read of the old one, and the read of a request is reused inside the
 * cooldown. A read that is in flight is shared: two boundaries that ask at
 * the same time cause one read.
 */
export class BdDiscovery {
	private readonly options: BdDiscoveryOptions;
	private cache: {
		generation: number;
		scannedAt: number;
		result: BdScanResult;
	} | null = null;
	private inFlight: Promise<BdScanResult> | null = null;

	constructor(options: BdDiscoveryOptions) {
		this.options = options;
	}

	/** The number of the request that is running. */
	private get generation(): number {
		return this.options.generation?.() ?? 0;
	}

	private get now(): number {
		return this.options.now?.() ?? Date.now();
	}

	/**
	 * Read the backlog, with the bounds of the discovery.
	 *
	 * The read is reused inside the cooldown, and a read that is in flight
	 * is shared. The result of a failed read is kept as "unavailable":
	 * the read is retried after the cooldown (or when the request
	 * changes, or when the read is forced), but the user sees the
	 * difference between "nothing is relevant" and "nothing was read".
	 */
	async scan(force = false): Promise<BdScanResult> {
		const ttl = this.options.ttlMs ?? 30_000;
		const cached = this.cache;
		if (
			!force &&
			cached &&
			cached.generation === this.generation &&
			this.now - cached.scannedAt < ttl
		) {
			return cached.result;
		}
		if (this.inFlight) return this.inFlight;
		this.inFlight = (async () => {
			let result: BdScanResult;
			try {
				result = await this.options.read();
			} catch (error) {
				result = {
					available: false,
					issues: [],
					reason:
						error instanceof Error ? error.message : String(error),
					scannedAt: this.now,
				};
			}
			this.cache = {
				generation: this.generation,
				scannedAt: result.scannedAt,
				result,
			};
			this.inFlight = null;
			return result;
		})();
		return this.inFlight;
	}

	/**
	 * The relevant issues of the request.
	 *
	 * The read is bounded, the relevance is decided before the cap, and the
	 * outcome names what was read, what was relevant and what was left out.
	 */
	async discover(
		context: BdRelevanceContext = {},
	): Promise<BdDiscoveryResult> {
		const scan = await this.scan();
		return selectRelevantIssues(scan, context, this.options.limit);
	}

	/** Forget the read of the request (a new request, a recheck of the human). */
	invalidate(): void {
		this.cache = null;
	}
}
