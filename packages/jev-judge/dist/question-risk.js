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
function matchPatterns(text, patterns, signals) {
    let matched = false;
    for (const { name, pattern } of patterns) {
        if (pattern.test(text)) {
            signals.push(name);
            matched = true;
        }
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
    const text = (input.text ?? "").toLowerCase();
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