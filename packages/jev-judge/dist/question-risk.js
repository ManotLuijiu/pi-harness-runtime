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
const ACTION_VERBS = /\b(delete|deletes|deleting|removed?|removing|drop|dropped|dropping|wipe|wipes|wiping|erase|erases|erasing|purge|purges|purging|truncate|truncates|truncating|revoke|revokes|revoking|rotate|rotates|rotating|reset|resets|resetting|rebuild|rebuilds|reinstall|reinstalls|uninstall|uninstalls|deploy|deploys|deploying|publish|publishes|publishing|release|releases|releasing|ship|ships|shipping|push|pushes|pushing|merge|merges|merging|rebase|rebases|force[- ]?push|squash|squashes|send|sends|sending|post|posts|posting|mail|mails|email|emails|notify|notifies|upload|uploads|uploading|transfer|transfers|wire|wires|pay|pays|paying|invoice|invoices|refund|refunds|migrate|migrates|migrating|upgrade|upgrades|downgrade|downgrades|install|installs|installing|overwrite|overwrites|overwriting|replace|replaces|replacing|rename|renames|renaming|move|moves|moving|copy|copies|copying|run|runs|running|execute|executes|restart|restarts|stop|stops|stopping|kill|kills|killing|close|closes|closing|grant|grants|granting|enable|enables|enabling|disable|disables|disabling|update|updates|updating|modify|modifies|modifying|write|writes|writing|patch|patches|patching|commit|commits|committing|revert|reverts|refactor|refactors|rewrite|rewrites|format|formats|lint|lints|generate|generates|create|creates|add|adds|implement|implements|build|builds|compile|compiles|seed|seeds|backfill|backfills|sync|syncs|fetch|fetches|query|queries|benchmark|benchmarks|profile|profiles|cleanup|cleanups|clean|cleans|prune|prunes)\b/i;
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
 * Words that name an action that destroys, drops or overwrites something.
 */
const DESTRUCTIVE_PATTERNS = [
    { name: "delete", pattern: /\b(delete|remove|drop|truncate|wipe|purge|destroy|erase)\b/ },
    { name: "reset", pattern: /\b(reset|rollback|revert)\b/ },
    { name: "revoke", pattern: /\b(revoke|rotate|invalidate)\b/ },
    { name: "force-push", pattern: /\b(force[\s-]?push|push\s+(--force|-f\b)|reset\s+--hard|clean\s+-\w*f)\b/ },
    { name: "drop-object", pattern: /\bdrop\s+(table|database|schema|collection|index|bucket)\b/ },
    { name: "delete-object", pattern: /\bdelete\s+(the\s+)?(database|table|file|folder|branch|tag|user|account|volume|key)\b/ },
    { name: "terminate", pattern: /\b(terminate|kill|shutdown|stop)\b/ },
    { name: "overwrite", pattern: /\boverwrite\b/ },
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
 */
const NEGATION_WORDS = /\b(do not|don'?t|never|without|avoid|refrain from|no need to)\b/;
/**
 * Is the action at this position prohibited?
 *
 * The negation has to stand in front of the action, in the same clause: a
 * negation that belongs to another clause ("delete the branch, do not touch
 * main") does not prohibit the deletion.
 */
function isNegated(text, index) {
    const before = text.slice(Math.max(0, index - 40), index);
    // The clause of the action starts after the last sentence break.
    const clause = before.split(/[.;!?\n]/).pop() ?? before;
    return NEGATION_WORDS.test(clause);
}
/**
 * Match the patterns of one kind of risk in a text.
 *
 * A pattern that is prohibited does not count: the words of a prohibition
 * are not a proposal.
 */
function matchPatterns(text, patterns, signals) {
    let matched = false;
    for (const { name, pattern } of patterns) {
        const match = pattern.exec(text);
        if (!match)
            continue;
        if (isNegated(text, match.index))
            continue;
        signals.push(name);
        matched = true;
    }
    return matched;
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
    const destructive = matchPatterns(text, DESTRUCTIVE_PATTERNS, signals);
    const external = matchPatterns(text, EXTERNAL_PATTERNS, signals);
    const sensitive = matchPatterns(text, SENSITIVE_PATTERNS, signals);
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
    // Unknown kind or unknown text: the action cannot be judged.
    if (!kind || !text.trim()) {
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