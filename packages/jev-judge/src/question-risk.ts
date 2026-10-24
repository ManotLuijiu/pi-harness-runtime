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

export type QuestionKindLike =
  | "routine"
  | "approval"
  | "clarification"
  | "explicit"
  | (string & {});

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

interface RiskPattern {
  /** The name of the signal, used for diagnostics. */
  name: string;
  pattern: RegExp;
}

/**
 * Words that name an action that destroys, drops or overwrites something.
 */
const DESTRUCTIVE_PATTERNS: RiskPattern[] = [
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
const EXTERNAL_PATTERNS: RiskPattern[] = [
	{ name: "production", pattern: /\b(production|prod|live)\b/ },
	{ name: "deploy", pattern: /\b(deploy|publish|release|ship)\b/ },
	{ name: "merge-main", pattern: /\bmerge\b.*\b(main|master|develop)\b/ },
	{ name: "notify-people", pattern: /\b(send|post|notify|email|message|announce)\b.*\b(users|customers|clients|everyone|subscribers|team|customer)\b/ },
	{ name: "money", pattern: /\b(payment|purchase|order|invoice|charge|refund|spend|billing)\b/ },
];

/**
 * Words that name a secret or a credential.
 */
const SENSITIVE_PATTERNS: RiskPattern[] = [
	{ name: "credentials", pattern: /\b(secret|credential|api[\s-]?key|token|password)\b/ },
];

function matchPatterns(
	text: string,
	patterns: RiskPattern[],
	signals: string[],
): boolean {
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
export function classifyQuestionRisk(
	input: QuestionRiskInput,
): QuestionRiskFacts {
	const text = (input.text ?? "").toLowerCase();
	const kind = input.kind;
	const signals: string[] = [];

	const destructive = matchPatterns(text, DESTRUCTIVE_PATTERNS, signals);
	const external = matchPatterns(text, EXTERNAL_PATTERNS, signals);
	const sensitive = matchPatterns(text, SENSITIVE_PATTERNS, signals);

	// The agent asked for permission for a concrete action.
	let requiresExplicitAuthorization =
		kind === "approval" || kind === "explicit";

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
