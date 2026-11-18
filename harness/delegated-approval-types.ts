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
	/** The kind of the operation. It is the headline of the request. */
	kind: DelegatedOperationKind;
	/**
	 * Every operation the request proposes.
	 *
	 * A request may name more than one operation: "may I commit my changes
	 * and push" is a commit and a push. The delegation is checked against
	 * this list, so a delegation for a commit never covers the push that
	 * came with it. The list falls back to the single kind of the request
	 * when it is not known.
	 */
	kinds?: DelegatedOperationKind[];
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
 * The words that turn a personal subject into an intent.
 *
 * A personal subject behind one of these words names a proposal of the
 * speaker ("then I will push to origin"), not a fact about the past ("the
 * service I deployed yesterday"). The window of the personal subject ends
 * at the word, so the operation behind it counts.
 *
 * Without this rule a question that proposes a commit and a push in two
 * sentences ("may I commit the change? then I will push to origin") was
 * read as a commit alone, and a delegation for the commit covered the
 * whole proposal.
 */
const INTENT_AFTER_SUBJECT = new Set([
	"will",
	"shall",
	"going",
	"about",
	"plan",
	"planning",
	"intend",
	"intending",
	"want",
	"wanting",
	"need",
	"needing",
	"would",
	"could",
	"should",
	"must",
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
			// A message that leaves the machine is an external write, in
			// every wording of it.
			"send",
			"sends",
			"sending",
			"mail",
			"mails",
			"email",
			"emails",
			"notify",
			"notifies",
			"post",
			"posts",
			"posting",
			"message",
			"messages",
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
 * The words that end the window of a personal subject.
 *
 * A conjunction starts a new operation: "commit my changes and push" names
 * two operations, and the push is not part of the phrase of the speaker.
 */
const CONJUNCTIONS = new Set([
	"and",
	"or",
	"then",
	"also",
	"plus",
	"afterwards",
]);

/**
 * The operations of one clause of an ask.
 */
function operationKindsOfClause(clause: string): {
	kinds: DelegatedOperationKind[];
	denied: boolean;
} {
	const words = clause
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
		if (personalWindow > 0 && CONJUNCTIONS.has(word)) {
			// The phrase of the speaker is over: the conjunction starts an
			// operation of its own.
			personalWindow = 0;
			continue;
		}
		if (PERSONAL_SUBJECTS.has(word)) {
			// The next words belong to the past of the speaker.
			personalWindow = 3;
			continue;
		}
		if (personalWindow > 0) {
			if (INTENT_AFTER_SUBJECT.has(word)) {
				// The speaker turns to an intent: the operation behind the
				// word is a proposal, not a fact about the past.
				personalWindow = 0;
				continue;
			}
			personalWindow -= 1;
			continue;
		}
		const kind = operationKindOfWord(word);
		if (kind && !kinds.includes(kind)) kinds.push(kind);
	}
	// A post to somebody else is an external write.
	if (!denied && /\bpost(?:s|ing)?\s+to\b/.test(clause)) {
		if (!kinds.includes("external-write")) kinds.push("external-write");
	}
	return { kinds, denied };
}

/**
 * The operations the ask names, in the order they appear.
 *
 * Every clause of the ask counts: "May I commit the change? Then push to
 * origin." names a commit and a push. A clause that is not read is an
 * operation nobody checked, so a delegation for the commit would cover a
 * question that also proposes the push.
 */
function operationKindsAfter(value: string, from: number): DelegatedOperationKind[] {
	const clauses = value.slice(from).split(/[.!?;\n]/);
	const kinds: DelegatedOperationKind[] = [];
	for (const clause of clauses) {
		const found = operationKindsOfClause(clause);
		// A denial speaks for the whole ask.
		if (found.denied) break;
		for (const kind of found.kinds) {
			if (!kinds.includes(kind)) kinds.push(kind);
		}
	}
	return kinds;
}

/**
 * Every operation a proposal names.
 *
 * A proposal may name more than one operation: "may I commit my changes
 * and push" is a commit and a push. The list is what the delegation is
 * checked against, so a delegation for one of them never covers the other.
 */
export function operationKindsFor(
	text: string | undefined,
): DelegatedOperationKind[] {
	const value = (text ?? "").toLowerCase();
	if (value.trim().length === 0) return [];
	const ask = INTENT_PATTERN.exec(value);
	if (!ask) return [];
	return operationKindsAfter(value, ask.index + ask[0].length);
}

/**
 * The scope of a question: every operation the question proposes.
 *
 * The scope is read from the complete question. The action of a question
 * is shortened for the display, and a question that is longer than that
 * bound still proposes every operation it names: classifying the
 * shortened text would drop the operations that lie behind the bound, and
 * a delegation for the operations that were read would cover the whole
 * question.
 *
 * The result is empty when the question names no operation: a question
 * without a known operation is covered by nothing.
 */
export function questionScope(
	questionText: string | undefined,
): DelegatedOperationKind[] {
	return operationKindsFor(questionText);
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
 *
 * The kind is the headline of the proposal, not its whole scope: a
 * proposal that names a commit and a deploy is a deploy, but the delegation
 * is checked against every operation of the proposal. Use
 * `operationKindsFor` for that.
 */
export function operationKindFor(
	text: string | undefined,
): DelegatedOperationKind | undefined {
	const kinds = operationKindsFor(text);
	if (kinds.length === 0) return undefined;
	if (kinds.includes("deploy")) return "deploy";
	if (kinds.includes("external-write")) return "external-write";
	if (kinds.includes("commit") && kinds.includes("push")) {
		return "commit-and-push";
	}
	return kinds[0];
}

/**
 * The primitive operations of a list of kinds.
 *
 * The compound kind "commit-and-push" covers a commit and a push, so it
 * stands for the two of them.
 */
function primitiveKinds(
	kinds: DelegatedOperationKind[],
): Set<DelegatedOperationKind> {
	const primitives = new Set<DelegatedOperationKind>();
	for (const kind of kinds) {
		if (kind === "commit-and-push") {
			primitives.add("commit");
			primitives.add("push");
			continue;
		}
		primitives.add(kind);
	}
	return primitives;
}

/**
 * The operations a request asks for.
 *
 * The headline of the request and the list of its operations are both
 * part of the ask: a request whose headline is a deploy and whose
 * operations are a commit and a deploy asks for all three. A caller that
 * names fewer operations than its headline cannot narrow the request
 * down, so the two are read together.
 *
 * The result holds the primitive operations, so a request without a known
 * operation asks for nothing and is covered by nothing.
 */
export function requiredOperations(
	kind: DelegatedOperationKind | undefined,
	kinds: DelegatedOperationKind[] | undefined,
): DelegatedOperationKind[] {
	const required = new Set<DelegatedOperationKind>();
	if (kind) {
		for (const primitive of primitiveKinds([kind])) required.add(primitive);
	}
	for (const entry of kinds ?? []) {
		for (const primitive of primitiveKinds([entry])) required.add(primitive);
	}
	// The order is stable, so a caller can compare the list.
	return [...required].sort((a, b) => a.localeCompare(b));
}

/**
 * Does a delegation cover every operation of a request?
 *
 * The check is exact: the workspace must be the same, the delegation must
 * not have expired, and every operation of the request must be one the
 * delegation names.
 *
 * A proposal may name more than one operation. "May I commit my changes
 * and push" is a commit and a push, and a delegation for a commit does not
 * cover the push: the delegation of the user is for the operation they
 * named, not for the operation that came with it.
 */
export function delegationCoversAll(
	delegation: Delegation,
	kinds: DelegatedOperationKind[],
	workspace: string,
	now: number,
): boolean {
	if (delegation.workspace !== workspace) return false;
	if (delegation.expiresAt !== undefined && delegation.expiresAt <= now) {
		return false;
	}
	// A request without an operation authorizes nothing.
	if (kinds.length === 0) return false;
	const covered = primitiveKinds(delegation.kinds);
	// The operations of the request are primitives too: a request whose
	// kind is the compound one covers a commit and a push.
	const required = primitiveKinds(kinds);
	for (const kind of required) {
		if (!covered.has(kind)) return false;
	}
	return true;
}
