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
    /** The complete question text. */
    text?: string;
}
/**
 * Derive the risk facts of a pending question.
 *
 * The rules:
 *
 * - A question that asks for permission for a concrete action ("approval",
 *   "explicit") needs the explicit authorization of a human. Jev never
 *   approves it on its own.
 * - A question that names a destructive action is destructive, and its
 *   reversibility cannot be proven - so it waits.
 * - A question with an unknown kind or an empty text is uncertain, and an
 *   uncertain case waits for the human.
 * - Only a routine question without a destructive or external signal is
 *   harmless enough for an autonomous decision.
 */
export declare function classifyQuestionRisk(input: QuestionRiskInput): QuestionRiskFacts;
//# sourceMappingURL=question-risk.d.ts.map