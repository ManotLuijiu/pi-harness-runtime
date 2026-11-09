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
 * The list is deliberately narrow. A wording that is not in the list is
 * treated as a question about the request, which keeps the judge useful.
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
 * Is the question an offer of work that was not asked for?
 *
 * The wording of the question decides, not the wording of the message around
 * it: a long message that talks about many things must not turn a question
 * about the request into an offer.
 */
export function classifyQuestionRelevance(text: string | undefined): {
	offer: boolean;
	reason: string;
} {
	const value = (text ?? "").trim();
	if (!value) {
		return { offer: false, reason: "the question has no text" };
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
 * The state of the work, from the task list.
 *
 * The list must not be read as "the work is done" when it says nothing: an
 * empty list is no evidence, and a list that could not be read is no
 * evidence either. Only a list that had work and has none left is complete.
 */
export function workStateFromTodos(
	items: readonly TodoStateLike[] | null | undefined,
	options: { available?: boolean; error?: string } = {},
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
	return unfinished ? "unfinished" : "complete";
}

/**
 * The relevance of a question, from its wording and the state of the work.
 */
export function questionRelevance(input: {
	/** The text of the question. */
	text: string | undefined;
	/** The state of the work when the question was asked. */
	work: JevWorkState;
}): JevQuestionRelevance {
	const offer = classifyQuestionRelevance(input.text);
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
	if (input.relevance === "current-request" && input.work === "complete") {
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
