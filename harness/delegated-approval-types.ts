/**
 * The approval of an operation that the human has to give.
 *
 * The harness asks the human before an operation it may not run on its own:
 * a commit, a push, a deployment, an external write. Two things can end
 * that question: the human answers, or the deadline passes.
 *
 * The deadline is not an answer. When it passes, the operation continues
 * only when the user delegated that outcome in advance, and only for the
 * kinds of operation the delegation names. A delegation is never extended
 * silently to an external or a destructive action.
 *
 * The decision is recorded with the source it really has: a click of the
 * human is `"human"`, a decision of the judge is `"jev"`, and the outcome
 * of a deadline that ran under a delegation is `"delegated-timeout"`.
 */

/**
 * The kinds of operation a delegation can cover.
 *
 * The vocabulary is small and closed. A delegation names the kinds it
 * covers, and a delegation for one kind never covers another: a
 * delegation for a commit does not cover a push.
 */
export const DELEGATED_OPERATION_KINDS = [
	"commit",
	"push",
	"commit-and-push",
	"deploy",
	"external-write",
] as const;

/** A kind of operation a delegation can cover. */
export type DelegatedOperationKind = (typeof DELEGATED_OPERATION_KINDS)[number];

/**
 * Is this a kind of operation a delegation can cover?
 *
 * A kind that is not in the vocabulary authorizes nothing: an unknown
 * operation is never covered by a delegation.
 */
export function isDelegatedOperationKind(
	value: unknown,
): value is DelegatedOperationKind {
	return (
		typeof value === "string" &&
		(DELEGATED_OPERATION_KINDS as readonly string[]).includes(value)
	);
}

/**
 * An advance delegation of the timeout decision.
 *
 * The user records it before the question: "if I do not answer within five
 * minutes, continue with a commit". The delegation is durable, and it
 * belongs to a workspace: a delegation of one workspace never covers the
 * operation of another one.
 */
export interface Delegation {
	/** The id of the delegation. */
	id: string;
	/** The workspace the delegation applies to. */
	workspace: string;
	/** The kinds of operation the delegation covers. */
	kinds: DelegatedOperationKind[];
	/** What happens at the deadline. */
	defaultOutcome: "continue" | "block";
	/** When the delegation was recorded. */
	recordedAt: number;
	/** When the delegation stops applying. */
	expiresAt?: number;
}

/**
 * Where a decision came from.
 *
 * The source is part of the decision: a timeout that ran under a
 * delegation is never recorded as a click of the human.
 */
export type ApprovalSource = "human" | "jev" | "delegated-timeout";

/** The answer of a human to a request. */
export type ApprovalOutcome = "yes" | "no";

/**
 * A request for the approval of an operation.
 */
export interface ApprovalRequest {
	/** The canonical id of the request. It is the id of the pending question. */
	requestId: string;
	/** The workspace of the operation. */
	workspace: string;
	/** The session of the request. */
	sessionId: string;
	/** The generation of the request. */
	generation: number;
	/** The kind of the operation. */
	kind: DelegatedOperationKind;
	/** The exact operation, in the words of the human. */
	operation: string;
	/** What stays blocked while the request is open. */
	blocked: string[];
	/** Why the operation is not simply running. */
	reason?: string;
	/** The deadline of the answer. It is absolute. */
	deadlineAt: number;
	/** The state of the request. */
	state: "pending" | "answered" | "claimed" | "expired";
	/** The answer, when there is one. */
	answer?: { outcome: ApprovalOutcome; source: ApprovalSource; at: number };
}

/**
 * The recorded decision of a request.
 *
 * The record is what makes the decision auditable: it names the source,
 * the delegation it rests on and the moment it was made.
 */
export interface ApprovalDecision {
	/** The request the decision belongs to. */
	requestId: string;
	/** The outcome of the decision. */
	outcome: ApprovalOutcome;
	/** Where the decision came from. */
	source: ApprovalSource;
	/** The delegation the decision rests on. */
	delegationId?: string;
	/** The reason of the decision. */
	reason?: string;
	/** When the decision was made. */
	at: number;
}

/**
 * The kind of operation of a proposal.
 *
 * The classification is narrow on purpose. A proposal whose kind is not
 * known is not covered by a delegation, so an unknown operation never
 * continues by silence.
 */
export function operationKindFor(
	text: string | undefined,
): DelegatedOperationKind | undefined {
	const value = (text ?? "").toLowerCase();
	if (value.length === 0) return undefined;
	const commit = /\bcommits?\b/.test(value);
	const push = /\bpush(?:ed|es|ing)?\b/.test(value);
	const deploy = /\bdeploy(?:ment|ed|ing)?\b|\bship(?:ped|s|ping)? to production\b/.test(value);
	const external = /\bpublish(?:ed|es|ing)?\b|\bupload(?:ed|s|ing)?\b|\bpost(?:ed|s|ing)? to\b/.test(
		value,
	);
	if (deploy) return "deploy";
	if (external) return "external-write";
	if (commit && push) return "commit-and-push";
	if (commit) return "commit";
	if (push) return "push";
	return undefined;
}

/**
 * Does a delegation cover an operation?
 *
 * The check is exact: the workspace must be the same, the delegation must
 * not have expired, and the kind of the operation must be one the
 * delegation names. A delegation for a commit does not cover a push, and
 * a delegation of one workspace does not cover the operation of another.
 */
export function delegationCovers(
	delegation: Delegation,
	kind: DelegatedOperationKind,
	workspace: string,
	now: number,
): boolean {
	if (delegation.workspace !== workspace) return false;
	if (delegation.expiresAt !== undefined && delegation.expiresAt <= now) {
		return false;
	}
	return delegation.kinds.includes(kind);
}
