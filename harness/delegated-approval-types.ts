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
 * The words that ask for permission to do something.
 *
 * The classification runs on free prose, so the words of the text are not
 * enough: a text that only mentions an operation does not propose it. The
 * question has to ask for something.
 */
const INTENT_STEMS = [
	"may i",
	"may we",
	"can i",
	"can we",
	"should i",
	"should we",
	"shall i",
	"would i",
	"could i",
	"am i allowed to",
	"are i allowed to",
	"is it ok to",
	"is it okay to",
	"is it fine to",
	"is it allowed to",
	"do you want me to",
	"do you want us to",
	"would you like me to",
	"would you like us to",
	"please",
	"go ahead and",
	"go ahead with",
	"go ahead",
	"ok to",
	"okay to",
	"i want to",
	"i need to",
	"i would like to",
	"we want to",
	"we need to",
	"authorize me to",
	"authorise me to",
	"allow me to",
	"let me",
	"let us",
];

/**
 * The pattern of an ask.
 *
 * The word boundary at the end matters: "may issue a ticket" is not an ask
 * of the shape "may i".
 */
const INTENT_PATTERN = new RegExp(
	`\\b(?:${INTENT_STEMS.map((stem) => stem.replace(/ /g, "\\s+")).join("|")})\\b`,
);

/**
 * The words that deny an operation.
 *
 * A denial speaks for the rest of the ask: "do not commit and push" denies
 * both.
 */
const DENYING_WORDS = new Set([
	"not",
	"never",
	"without",
	"avoid",
	"skip",
	"refuse",
	"deny",
	"denied",
	"neither",
	"nor",
]);

/**
 * The personal subjects.
 *
 * An operation behind one of them is a fact and not a proposal: "the
 * service I deployed yesterday" talks about the past.
 */
const PERSONAL_SUBJECTS = new Set([
	"i",
	"we",
	"he",
	"she",
	"they",
	"you",
	"it",
	"my",
	"our",
	"me",
	"us",
	"them",
]);

/**
 * The operations and the words that name them.
 *
 * Only the active forms are named. The past tense describes what happened
 * and never proposes anything, so a delegation must not cover it.
 */
const OPERATION_WORDS: { kind: DelegatedOperationKind; words: string[] }[] = [
	{ kind: "commit", words: ["commit", "commits", "committing"] },
	{ kind: "push", words: ["push", "pushes", "pushing"] },
	{
		kind: "deploy",
		words: [
			"deploy",
			"deploys",
			"deploying",
			"deployment",
			"deployments",
			"ship",
			"ships",
			"shipping",
		],
	},
	{
		kind: "external-write",
		words: [
			"publish",
			"publishes",
			"publishing",
			"publication",
			"upload",
			"uploads",
			"uploading",
		],
	},
];

/**
 * The kind of operation a word names.
 */
function operationKindOfWord(word: string): DelegatedOperationKind | undefined {
	for (const entry of OPERATION_WORDS) {
		if (entry.words.includes(word)) return entry.kind;
	}
	return undefined;
}

/**
 * The operations the ask names, in the order they appear.
 */
function operationKindsAfter(value: string, from: number): DelegatedOperationKind[] {
	const sentence = value.slice(from).split(/[.!?;\n]/)[0] ?? "";
	const words = sentence
		.split(/[^a-z0-9-]+/)
		.filter((word) => word.length > 0);
	const kinds: DelegatedOperationKind[] = [];
	let personalWindow = 0;
	let denied = false;
	for (const word of words) {
		if (DENYING_WORDS.has(word)) {
			// The denial speaks for the rest of the ask.
			denied = true;
			continue;
		}
		if (denied) continue;
		if (PERSONAL_SUBJECTS.has(word)) {
			// The next words belong to the past of the speaker.
			personalWindow = 3;
			continue;
		}
		if (personalWindow > 0) {
			personalWindow -= 1;
			continue;
		}
		const kind = operationKindOfWord(word);
		if (kind && !kinds.includes(kind)) kinds.push(kind);
	}
	// A post to somebody else is an external write.
	if (!denied && /\bpost(?:s|ing)?\s+to\b/.test(sentence)) {
		if (!kinds.includes("external-write")) kinds.push("external-write");
	}
	return kinds;
}

/**
 * The kind of operation of a proposal.
 *
 * The classification is narrow on purpose. A proposal whose kind is not
 * known is not covered by a delegation, so an unknown operation never
 * continues by silence.
 *
 * The text is free prose, so a word is not enough: the text has to ask for
 * something, and the operation has to be the active form of the ask. A
 * mention of the past ("the service I deployed yesterday") and a denial
 * ("do not commit") name no operation at all.
 */
export function operationKindFor(
	text: string | undefined,
): DelegatedOperationKind | undefined {
	const value = (text ?? "").toLowerCase();
	if (value.trim().length === 0) return undefined;
	const ask = INTENT_PATTERN.exec(value);
	if (!ask) return undefined;
	const kinds = operationKindsAfter(value, ask.index + ask[0].length);
	if (kinds.length === 0) return undefined;
	if (kinds.includes("deploy")) return "deploy";
	if (kinds.includes("external-write")) return "external-write";
	if (kinds.includes("commit") && kinds.includes("push")) {
		return "commit-and-push";
	}
	return kinds[0];
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
