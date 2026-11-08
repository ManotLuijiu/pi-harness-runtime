/**
 * The risk facts of a pending question.
 *
 * The autonomous decision is only as safe as the facts it is based on: a
 * question that asks for permission for a destructive or irreversible
 * action must never be approved while the user is away. The facts are
 * derived deterministically from the question the agent asked and from the
 * kind of the question - never from a guess.
 *
 * The classifier is deliberately conservative: an uncertain case is
 * classified as "needs an explicit authorization", so the deterministic
 * policy waits for a human instead of continuing the work.
 */
export type QuestionKindLike = "routine" | "approval" | "clarification" | "explicit" | (string & {});
/** The risk facts of a proposed action. */
export interface QuestionRiskFacts {
    /** Does the action need an explicit human authorization? */
    requiresExplicitAuthorization: boolean;
    /** Can the action destroy or damage something? */
    destructive: boolean;
    /** Can the action be undone? */
    reversible: boolean;
    /** Does the action reach the outside world? */
    external: boolean;
    /** The signals that produced the facts (for diagnostics). */
    signals: string[];
}
export interface QuestionRiskInput {
    /** The kind of the question ("routine", "approval", ...). */
    kind?: QuestionKindLike;
    /**
     * The typed ask of the question ("approval", "choice",
     * "clarification", "explicit_authorization", "routine").
     *
     * An explicit authorization is a request that the message reserves for
     * the human, so it never becomes an autonomous decision.
     */
    askType?: string;
    /** The complete question text. */
    text?: string;
    /**
     * The concrete action the agent proposes.
     *
     * The risk is about the action, not about the whole message: a message
     * that talks about many things carries words that have nothing to do with
     * the action that is proposed.
     */
    proposedAction?: string;
    /**
     * The action of the question itself.
     *
     * It is assessed on its own text: the risk of the question is the risk of
     * the question, not of the message around it. A long message cannot push
     * the action of the question out of the assessment, and a negation of the
     * message cannot govern it.
     */
    questionAction?: string;
}
/**
 * How much of the action reaches the classifier.
 */
export declare const MAX_ACTION_CHARS = 600;
/**
 * The action the agent proposes.
 *
 * The message carries the ask ("may I proceed?") and the action ("I will
 * delete the branch"). The risk is about the action, so the action is
 * extracted: the sentences of the message that state what happens. The
 * question sentence itself is not an action - it asks, it does not act.
 *
 * When the message names no action, the question text is the action: the
 * risk of the question is then the risk of the ask.
 *
 * The action of the question is not part of this text. It is extracted on
 * its own (`extractQuestionAction`) and assessed on its own, so a long
 * message around it cannot push it out of the assessment.
 */
export declare function extractProposedAction(contextText: string | undefined, questionText: string | undefined): string;
/**
 * The action of the question itself.
 *
 * The question can carry the action that the message does not name: "I can
 * update the status text. Want me to delete the production database?" states
 * a harmless action in the message and asks for a deletion in the question.
 *
 * The action of the question is extracted and assessed on its own text:
 *
 *  - a long explanation around it cannot push it out of the assessment (the
 *    bound of the context is a bound of the context, not of the question),
 *  - a negation in the message cannot govern it (the negation of the
 *    message speaks about the message).
 *
 * `undefined` means that the question names no action: it asks, it does not
 * act.
 */
export declare function extractQuestionAction(questionText: string | undefined): string | undefined;
/**
 * Derive the risk facts of a pending question.
 *
 * The rules:
 *
 * - A question of kind "explicit" asks for an explicit human authorization.
 *   Jev never approves it on its own.
 * - A question of kind "approval" is the agent proposing work. It stays
 *   auto-approvable as long as nothing in it is risky - that is the whole
 *   point of the timeout: routine, reversible work continues when the user
 *   is away.
 * - A question that names a destructive action is destructive, and its
 *   reversibility cannot be proven - so it waits.
 * - A question that reaches the outside world or touches a secret needs a
 *   human as well.
 * - A question with an unknown kind or an empty text is uncertain, and an
 *   uncertain case waits for the human.
 */
export declare function classifyQuestionRisk(input: QuestionRiskInput): QuestionRiskFacts;
//# sourceMappingURL=question-risk.d.ts.map