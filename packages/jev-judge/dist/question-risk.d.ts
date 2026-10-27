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
}
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