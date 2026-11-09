/**
 * The eligibility of an automatic Jev wait.
 *
 * One decision, shared by the creation of a wait, the reconciliation with the
 * finished work, the evaluation at the deadline and the application of a
 * result. The rule lives here, so the four places cannot disagree.
 *
 * The decision answers one question: may the silence of the human be read as
 * "yes"?
 *
 *  - An offer of work that was not asked for is never answered by silence.
 *    It waits for an explicit new request.
 *  - A question about work that has been done is obsolete. It blocks
 *    nothing.
 *  - A question about work that remains keeps its policy: the judge decides
 *    it as before.
 *  - An unknown state of the work is never a completion. The question is
 *    preserved.
 */

/**
 * The state of the work of the current request.
 *
 * - `unfinished`: work remains, so a question can belong to it.
 * - `complete`: work was there and it is done.
 * - `unknown`: there is no evidence. The task list is empty, the provider is
 *   unavailable, or the read failed.
 */
export type JevWorkState = "unfinished" | "complete" | "unknown";

/**
 * What the question is about.
 *
 * - `current-request`: the question asks for a decision about work that
 *   remained when it was asked.
 * - `optional-offer`: the question offers work that was not asked for.
 * - `final-request`: the question asks for a decision after the work of the
 *   request was already done.
 */
export type JevQuestionRelevance =
	| "current-request"
	| "optional-offer"
	| "final-request";

/** The part of a todo item the rules need. */
export interface TodoStateLike {
	/** The status of the item ("pending", "in_progress", "completed", ...). */
	status: string;
}

/** The decision about an automatic wait. */
export interface JevWaitEligibility {
	/** May the wait count down and let the judge decide? */
	eligible: boolean;
	/** Why, in words. */
	reason: string;
}

/**
 * The wordings that offer work instead of asking about the work at hand.
 *
 * An offer is not a question about the request: it proposes something that
 * was never asked for. Silence must not authorize it, so an offer never
 * reaches the judge.
 *
 * The list is a fallback only. It is consulted when the requested scope is
 * unknown, because the scope decides when it is known: the wording of a
 * question is not a fact about what was asked for. "Want me to implement A,
 * or A+B?" is phrased like an offer and asks about the request itself.
 */
const OFFER_WORDINGS: readonly RegExp[] = [
	/\bwould you like me to\b/i,
	/\bdo you want me to\b/i,
	/\bwould you like me if\b/i,
	/\bwant me to\b/i,
	/\bshall i also\b/i,
	/\bshould i also\b/i,
	/\bcan i also\b/i,
	/\banything else\b/i,
	/\banything more\b/i,
	/\bis there anything\b/i,
];

/**
 * The words that carry no scope.
 *
 * They are the same in a request and in a question about it, so they never
 * show that a question is about the requested work.
 */
const SCOPE_STOP_WORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"but",
	"by",
	"can",
	"do",
	"does",
	"for",
	"from",
	"has",
	"have",
	"i",
	"if",
	"in",
	"is",
	"it",
	"its",
	"me",
	"my",
	"of",
	"on",
	"or",
	"our",
	"should",
	"shall",
	"so",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"these",
	"they",
	"this",
	"to",
	"us",
	"want",
	"was",
	"we",
	"were",
	"what",
	"when",
	"which",
	"will",
	"with",
	"would",
	"you",
	"your",
]);

/**
 * The words of a text that name something.
 *
 * The comparison of the scope uses these words: a question is about the
 * requested work when it names the same things.
 */
function scopeTerms(text: string | undefined): string[] {
	const words = (text ?? "")
		.toLowerCase()
		.split(/[^a-z0-9+#]+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 3 && !SCOPE_STOP_WORDS.has(word));
	return Array.from(new Set(words));
}

/**
 * Is the question an offer of work that was not asked for?
 *
 * The requested scope decides when it is known: a question that names the
 * work of the request is a question about the request, and a question that
 * names something else proposes work that was never asked for. The wording
 * of the question is the fallback, for the case that the scope is unknown.
 */
export function classifyQuestionRelevance(
	text: string | undefined,
	options: {
		/** The work that was requested: the subjects of the todos. */
		scope?: readonly string[] | undefined;
		/** The action that the question proposes, when it was extracted. */
		action?: string | undefined;
	} = {},
): {
	offer: boolean;
	reason: string;
} {
	const value = (text ?? "").trim();
	if (!value) {
		return { offer: false, reason: "the question has no text" };
	}
	const scope = options.scope;
	if (scope && scope.length > 0) {
		const wanted = new Set(scopeTerms(scope.join(" ")));
		if (wanted.size > 0) {
			// The action of the question is compared with the scope, not the
			// whole message: a message around the question talks about many
			// things and must not decide the question.
			const action = options.action?.trim() || value;
			const shared = scopeTerms(action).filter((term) => wanted.has(term));
			if (shared.length > 0) {
				return {
					offer: false,
					reason: `the question asks about the requested scope (${shared.join(", ")})`,
				};
			}
			return {
				offer: true,
				reason: "the question proposes work that the request does not name",
			};
		}
	}
	for (const wording of OFFER_WORDINGS) {
		if (wording.test(value)) {
			return {
				offer: true,
				reason: "the question offers work that was not asked for",
			};
		}
	}
	return { offer: false, reason: "the question asks about the request" };
}

/**
 * Is the question that waits now the question that was checked?
 *
 * A check that captured a question may only act on that question: a
 * question that was answered, replaced or cancelled in the meantime owns
 * its own wait.
 */
export function ownsQuestion(
	current: { requestId?: string } | null | undefined,
	requestId: string,
): boolean {
	return current != null && current.requestId === requestId;
}

/**
 * The state of the work, from the task list.
 *
 * The list must not be read as "the work is done" when it says nothing: an
 * empty list is no evidence, and a list that could not be read is no
 * evidence either. Only a list that had work and has none left is complete.
 */
export function workStateFromTodos(
	items: readonly TodoStateLike[] | null | undefined,
	options: {
		available?: boolean;
		error?: string;
		/**
		 * Is a required validation still pending?
		 *
		 * A todo that is marked complete while its final tier has not passed
		 * is not done: the required validation is work that remains, so the
		 * request is not finished.
		 */
		validationPending?: boolean;
	} = {},
): JevWorkState {
	if (options.available === false) {
		return "unknown";
	}
	if (!items) {
		return "unknown";
	}
	const relevant = items.filter((item) => item.status !== "deleted");
	if (relevant.length === 0) {
		// There was no work to do. That is not a proof that the request is
		// finished: a question can be the reason no task was ever created.
		return "unknown";
	}
	const unfinished = relevant.some(
		(item) => item.status === "pending" || item.status === "in_progress",
	);
	if (unfinished) return "unfinished";
	if (options.validationPending === true) {
		// The todos are done, but the required validation has not passed.
		// The request is not finished.
		return "unfinished";
	}
	return "complete";
}

/**
 * The relevance of a question, from its wording and the state of the work.
 */
export function questionRelevance(input: {
	/** The text of the question. */
	text: string | undefined;
	/** The state of the work when the question was asked. */
	work: JevWorkState;
	/** The work that was requested: the subjects of the todos. */
	scope?: readonly string[] | undefined;
	/** The action that the question proposes, when it was extracted. */
	action?: string | undefined;
}): JevQuestionRelevance {
	const offer = classifyQuestionRelevance(input.text, {
		scope: input.scope,
		action: input.action,
	});
	if (offer.offer) return "optional-offer";
	if (input.work === "complete") return "final-request";
	return "current-request";
}

/**
 * Is the open question obsolete?
 *
 * A question about work that has been done is obsolete: it blocks nothing
 * and it keeps no countdown. A question about work that remains, and a
 * question whose state is unknown, stay.
 */
export function isObsoleteQuestion(input: {
	/** What the question is about. */
	relevance: JevQuestionRelevance;
	/** The state of the work now. */
	work: JevWorkState;
}): { obsolete: boolean; reason: string } {
	if (input.relevance !== "current-request") {
		return {
			obsolete: false,
			reason: "the question is not about work that remained",
		};
	}
	if (input.work === "complete") {
		return { obsolete: true, reason: "the work of the question is done" };
	}
	return {
		obsolete: false,
		reason: "the work of the question may still remain",
	};
}

/**
 * End an obsolete wait.
 *
 * The question and the wait die together: the timer, the row of the judge
 * and the evaluation of that request. No answer is injected, because nobody
 * answered anything.
 *
 * Only the owner of the wait is touched. A countdown of another owner keeps
 * its deadline and its state.
 */
export function clearObsoleteWait(options: {
	/** The identity of the question that is closed. */
	requestId: string;
	/** Cancel the question of the controller. */
	cancelQuestion: (reason: string) => void;
	/** End the wait of the lifecycle. */
	cancelWait: () => void;
	/** Remove the row of the judge, when there is one. */
	removeRow?: (requestId: string) => void;
	/** The reason of the cleanup. */
	reason?: string;
}): void {
	const reason = options.reason ?? "the work of the question is done";
	options.cancelQuestion(reason);
	options.cancelWait();
	options.removeRow?.(options.requestId);
}

/**
 * May the wait count down and let the judge decide?
 *
 * The rules:
 *
 *  - An offer is never eligible: the silence of the human must not start
 *    work that nobody asked for.
 *  - A question that was asked after the work of the request was done is
 *    never eligible: the request is finished, so the question asks for
 *    something beyond it and waits for an explicit new request.
 *  - A question about work that has been done is obsolete: the work it
 *    belongs to is finished, so it blocks nothing.
 *  - Everything else is eligible, including an unknown state of the work:
 *    uncertainty is never a completion.
 */
export function jevWaitEligibility(input: {
	/** What the question is about. */
	relevance: JevQuestionRelevance;
	/** The state of the work now. */
	work: JevWorkState;
}): JevWaitEligibility {
	if (input.relevance === "optional-offer") {
		return {
			eligible: false,
			reason:
				"the question offers work that was not asked for; the silence of the user must not authorize it",
		};
	}
	if (input.relevance === "final-request") {
		return {
			eligible: false,
			reason:
				"the work of the request is done; the question asks for something beyond it and waits for an explicit request",
		};
	}
	if (input.work === "complete") {
		return {
			eligible: false,
			reason: "the work of the question is done; the question is obsolete",
		};
	}
	if (input.work === "unknown") {
		return {
			eligible: true,
			reason: "the state of the work is unknown; the question is preserved",
		};
	}
	return {
		eligible: true,
		reason: "the question belongs to work that remains",
	};
}
