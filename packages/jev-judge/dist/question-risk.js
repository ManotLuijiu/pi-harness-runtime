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
/**
 * How much of the action reaches the classifier.
 */
export const MAX_ACTION_CHARS = 600;
/**
 * The verbs that state a concrete action.
 *
 * The risk is about the action that is proposed, so the action has to be
 * found in the message. A sentence that names no action does not belong to
 * the action: it talks about the request, not about what happens.
 */
const ACTION_VERBS = /\b(delete|deletes|deleted|deleting|remove|removes|removed|removing|drop|drops|dropped|dropping|wipe|wipes|wiped|wiping|erase|erases|erased|erasing|purge|purges|purged|purging|truncate|truncates|truncated|truncating|destroy|destroys|destroyed|destroying|revoke|revokes|revoked|revoking|rotate|rotates|rotated|rotating|reset|resets|resetting|rebuild|rebuilds|reinstall|reinstalls|uninstall|uninstalls|deploy|deploys|deploying|publish|publishes|publishing|release|releases|releasing|ship|ships|shipping|push|pushes|pushing|merge|merges|merging|rebase|rebases|force[- ]?push|squash|squashes|send|sends|sending|post|posts|posting|mail|mails|email|emails|notify|notifies|upload|uploads|uploading|transfer|transfers|wire|wires|pay|pays|paying|invoice|invoices|refund|refunds|migrate|migrates|migrating|upgrade|upgrades|downgrade|downgrades|install|installs|installing|overwrite|overwrites|overwritten|overwriting|replace|replaces|replacing|rename|renames|renaming|move|moves|moving|copy|copies|copying|run|runs|running|execute|executes|restart|restarts|stop|stops|stopped|stopping|kill|kills|killed|killing|close|closes|closing|grant|grants|granting|enable|enables|enabling|disable|disables|disabling|update|updates|updating|modify|modifies|modifying|write|writes|writing|patch|patches|patching|commit|commits|committing|revert|reverts|reverted|reverting|refactor|refactors|rewrite|rewrites|format|formats|lint|lints|generate|generates|create|creates|add|adds|implement|implements|build|builds|compile|compiles|seed|seeds|backfill|backfills|sync|syncs|fetch|fetches|query|queries|benchmark|benchmarks|profile|profiles|cleanup|cleanups|clean|cleans|prune|prunes)\b/i;
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
export function extractProposedAction(contextText, questionText) {
    const question = (questionText ?? "").trim();
    const context = (contextText ?? "").trim();
    if (context.length === 0)
        return question.slice(0, MAX_ACTION_CHARS);
    const sentences = context
        .split(/(?<=[.!?])\s+|\n+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
    const actionSentences = sentences.filter((sentence) => sentence !== question && ACTION_VERBS.test(sentence));
    if (actionSentences.length === 0) {
        return question.slice(0, MAX_ACTION_CHARS);
    }
    return actionSentences.join(" ").slice(0, MAX_ACTION_CHARS);
}
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
export function extractQuestionAction(questionText) {
    const question = (questionText ?? "").trim();
    if (question.length === 0)
        return undefined;
    const sentences = question
        .split(/(?<=[.!?])\s+|\n+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
    const actionSentences = sentences.filter((sentence) => ACTION_VERBS.test(sentence));
    if (actionSentences.length === 0)
        return undefined;
    return actionSentences.join(" ").slice(0, MAX_ACTION_CHARS);
}
/**
 * Words that name an action that destroys, drops or overwrites something.
 *
 * The destructive verbs and their inflected forms.
 *
 * A risk pattern that only knows the bare singular of its verb misses the
 * action in every other form: "the production database will be removed"
 * destroys exactly as much as "remove the production database". The forms
 * are the ones the action verbs of this file name (see ACTION_VERBS).
 */
const DESTRUCTIVE_PATTERNS = [
    {
        name: "delete",
        pattern: /\b(delete|deletes|deleted|deleting|remove|removes|removed|removing|drop|drops|dropped|dropping|truncate|truncates|truncated|truncating|wipe|wipes|wiped|wiping|purge|purges|purged|purging|destroy|destroys|destroyed|destroying|erase|erases|erased|erasing)\b/,
    },
    {
        name: "reset",
        pattern: /\b(reset|resets|resetting|rollback|rollbacks|rolled\s+back|revert|reverts|reverted|reverting)\b/,
    },
    {
        name: "revoke",
        pattern: /\b(revoke|revokes|revoked|revoking|rotate|rotates|rotated|rotating|invalidate|invalidates|invalidated|invalidating)\b/,
    },
    {
        name: "force-push",
        pattern: /\b(force[\s-]?push(es|ed|ing)?|push(es|ed|ing)?\s+(--force|-f\b)|reset\s+--hard|clean\s+-\w*f)\b/,
    },
    {
        name: "drop-object",
        pattern: /\b(drop|drops|dropped|dropping)\s+(the\s+)?(table|database|schema|collection|index|bucket)\b/,
    },
    {
        name: "delete-object",
        pattern: /\b(delete|deletes|deleted|deleting|remove|removes|removed|removing)\s+(the\s+)?(database|table|file|folder|branch|tag|user|account|volume|key)\b/,
    },
    {
        name: "terminate",
        pattern: /\b(terminate|terminates|terminated|terminating|kill|kills|killed|killing|shutdown|shut\s+down|stop|stops|stopped|stopping)\b/,
    },
    {
        name: "overwrite",
        pattern: /\b(overwrite|overwrites|overwritten|overwriting)\b/,
    },
];
/**
 * Words that name an action that reaches the outside world.
 */
const EXTERNAL_PATTERNS = [
    { name: "production", pattern: /\b(production|prod|live)\b/ },
    { name: "deploy", pattern: /\b(deploy|publish|release|ship)\b/ },
    { name: "merge-main", pattern: /\bmerge\b.*\b(main|master|develop)\b/ },
    { name: "notify-people", pattern: /\b(send|post|notify|email|message|announce)\b.*\b(users|customers|clients|everyone|subscribers|team|customer)\b/ },
    { name: "money", pattern: /\b(payment|purchase|order|invoice|charge|refund|spend|billing)\b/ },
];
/**
 * Words that name a secret or a credential.
 */
const SENSITIVE_PATTERNS = [
    { name: "credentials", pattern: /\b(secret|credential|api[\s-]?key|token|password)\b/ },
];
/**
 * The words that turn an action into a prohibition.
 *
 * "do not delete anything" is a prohibition, not a proposal: the risk of a
 * message must not turn the words of a prohibition into a destructive
 * action that blocks the work for good.
 *
 * The list carries the forms that really occur: the plain "not" of "will
 * not delete" belongs to it, and so do the contractions. "not" alone is
 * only a negation when it governs the action - see isNegated().
 */
const NEGATION_WORDS = /\b(do not|don'?t|never|without|avoid|refrain from|no need to|must not|shall not|cannot|can'?t|won'?t|shouldn'?t|mustn'?t|not)\b/;
/**
 * The words that stand between a negation and the action it governs.
 *
 * A negation that is separated from the action by a comma, a conjunction
 * or a colon belongs to another part of the sentence: "this is not a test,
 * delete the production database" proposes the deletion, "do not approve
 * the request, then delete the branch" proposes the deletion too.
 *
 * "or" is not one of them: "do not remove or delete the branch" prohibits
 * both actions, and the negation governs the second one as well.
 */
const NEGATION_BREAK = /[;:,]|\band\b|\bthen\b/;
/**
 * How many words may stand between a negation and the action.
 *
 * A negation governs the words that follow it closely: "will not delete",
 * "cannot deploy", "never remove". A negation that is further away
 * belongs to something else ("the plan is not ready so we should delete
 * the branch").
 */
const NEGATION_DISTANCE_WORDS = 3;
/**
 * Is the action at this position prohibited?
 *
 * The negation has to stand in front of the action, in the same clause: a
 * negation that belongs to another clause ("delete the branch, do not touch
 * main") does not prohibit the deletion.
 *
 * The last negation of the clause is the one that counts, and it has to
 * govern the action: nothing may stand between them that would make the
 * negation belong to another part of the sentence.
 */
function isNegated(text, index) {
    const before = text.slice(0, index);
    // The clause of the action starts after the last sentence break.
    const clause = before.split(/[.;!?\n]/).pop() ?? before;
    const matches = [...clause.matchAll(new RegExp(NEGATION_WORDS.source, "gi"))];
    const last = matches[matches.length - 1];
    if (!last)
        return false;
    const between = clause.slice(last.index + last[0].length);
    if (NEGATION_BREAK.test(between))
        return false;
    // The negation governs the action only when it stands close to it.
    const words = between.trim().length === 0 ? 0 : between.trim().split(/\s+/).length;
    return words <= NEGATION_DISTANCE_WORDS;
}
/**
 * Match the patterns of one kind of risk in a text.
 *
 * A pattern that is prohibited does not count: the words of a prohibition
 * are not a proposal.
 *
 * Every occurrence of a pattern is examined: a prohibited occurrence does
 * not hide a later one that is proposed ("do not delete the branch, instead
 * delete the production database"). The pattern counts when at least one
 * of its occurrences is not prohibited.
 */
function matchPatterns(text, patterns, signals) {
    let matched = false;
    for (const { name, pattern } of patterns) {
        const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
        let match;
        while ((match = global.exec(text)) !== null) {
            if (match[0].length === 0) {
                global.lastIndex += 1;
                continue;
            }
            if (isNegated(text, match.index))
                continue;
            signals.push(name);
            matched = true;
            break;
        }
    }
    return matched;
}
/**
 * The risk patterns of one text.
 *
 * The signal names are collected, so the diagnostics name every pattern that
 * matched - in the message as well as in the question.
 */
function classifyActionText(text, signals) {
    return {
        destructive: matchPatterns(text, DESTRUCTIVE_PATTERNS, signals),
        external: matchPatterns(text, EXTERNAL_PATTERNS, signals),
        sensitive: matchPatterns(text, SENSITIVE_PATTERNS, signals),
    };
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
export function classifyQuestionRisk(input) {
    // The risk is about the action that is proposed. The proposed action
    // describes it best; without one the question text does. The whole
    // message is not the input: it carries the words of everything the
    // agent said, and a word is not a risk.
    const action = (input.proposedAction ?? input.text ?? "").trim();
    const text = action.toLowerCase();
    const kind = input.kind;
    const signals = [];
    const actionRisk = classifyActionText(text, signals);
    // The question can carry an action of its own, and it is assessed on
    // its own text: the bound of the message is a bound of the message, and
    // a negation of the message speaks about the message.
    const questionAction = (input.questionAction ?? "").trim();
    const questionRisk = questionAction.length > 0
        ? classifyActionText(questionAction.toLowerCase(), signals)
        : null;
    const destructive = actionRisk.destructive || (questionRisk?.destructive ?? false);
    const external = actionRisk.external || (questionRisk?.external ?? false);
    const sensitive = actionRisk.sensitive || (questionRisk?.sensitive ?? false);
    // Only an explicitly demanded authorization blocks the autonomous
    // decision. An "approval" question is the agent proposing work: it
    // stays auto-approvable unless the wording names a risky action.
    let requiresExplicitAuthorization = kind === "explicit";
    // A typed ask that reserves the decision for the human blocks it too.
    // The typed ask is derived from the whole message, so the requirement
    // the agent states itself is not lost.
    if (input.askType === "explicit_authorization") {
        requiresExplicitAuthorization = true;
        signals.push("explicit-authorization");
    }
    // A destructive action never gets an autonomous approval.
    if (destructive) {
        requiresExplicitAuthorization = true;
    }
    // An action that reaches the outside world or touches a secret needs a
    // human as well.
    if (external || sensitive) {
        requiresExplicitAuthorization = true;
    }
    // Unknown kind or unknown text: the action cannot be judged. The action
    // of the question counts as a known text: it is judged on its own.
    const knownText = text.trim().length > 0 || questionAction.length > 0;
    if (!kind || !knownText) {
        requiresExplicitAuthorization = true;
        signals.push("unknown-question");
    }
    return {
        requiresExplicitAuthorization,
        destructive,
        // A destructive action is not provably reversible.
        reversible: !destructive,
        external,
        signals,
    };
}
//# sourceMappingURL=question-risk.js.map