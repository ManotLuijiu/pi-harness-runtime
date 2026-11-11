/**
 * The scope of an automatic resume.
 *
 * An automatic resume continues the request that is running. It is not an
 * instruction to find more work: a queued `resume` that arrives after the
 * request is complete sends the agent to the backlog, and the backlog is
 * not work of this request.
 *
 * The mechanical question - does authorized work remain? - belongs in code
 * and not in the judge. The judge answers the other question: whether a
 * concrete proposed scope may be taken on.
 *
 * The decision is deliberately conservative. An unknown state is not a
 * completion: the uncertainty is preserved and the resume goes on, because
 * stopping work that is unfinished is worse than asking again.
 */

/** The state of the work of the request that is running. */
export type ResumeWorkState = "unfinished" | "complete" | "unknown";

/** What the guard does with an automatic resume. */
export type ResumeScopeAction = "continue" | "suppress";

export interface ResumeScopeInput {
	/** The state of the work of the request that is running. */
	work: ResumeWorkState;
	/** The reason of the resume, for the report. */
	reason: string;
}

export interface ResumeScopeDecision {
	/** The action of the guard. */
	action: ResumeScopeAction;
	/** The reason of the decision, for the log. */
	reason: string;
	/** The line the user sees when the resume is suppressed. */
	report?: string;
}

/**
 * The rule that the agent keeps across a compaction.
 *
 * The rule is reinforcement, not enforcement: the guard in the code owns
 * the decision, and this text tells the agent what the guard decided and
 * why the backlog is not the next task.
 */
export const RESUME_SCOPE_RULE = [
	"An automatic resume continues only the current authorized request.",
	"If that request and its required validation are finished, remain stopped.",
	"Pending issues in bd or another backlog are not pending work of this request.",
	"Propose any new scope separately; do not create executable todos for it",
	"until the human or the configured Jev proposal policy authorizes it.",
].join(" ");

/**
 * The decision of the guard.
 *
 * - Work of the request remains: the resume goes on, and it continues that
 *   work only.
 * - The work of the request is complete: the resume is suppressed. The
 *   agent is not told to find something else, and no backlog issue becomes
 *   work of this request.
 * - The state is unknown: the resume goes on. The uncertainty is preserved
 *   - the guard does not declare a completion it cannot prove, and it does
 *   not substitute unrelated work either.
 */
export function decideResumeScope(input: ResumeScopeInput): ResumeScopeDecision {
	if (input.work === "complete") {
		return {
			action: "suppress",
			reason: "the work of the request is complete",
			report: `The work of the request is complete; the automatic resume (${input.reason}) is not sent.`,
		};
	}
	if (input.work === "unknown") {
		return {
			action: "continue",
			reason: "the state of the work is unknown; the uncertainty is preserved",
		};
	}
	return {
		action: "continue",
		reason: "the work of the request is unfinished",
	};
}
