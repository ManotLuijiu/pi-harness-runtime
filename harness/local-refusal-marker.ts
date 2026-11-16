/**
 * The marker of a local refusal.
 *
 * A local refusal is a decision of the harness and not a message of the
 * human: the harness refuses an action on its own, without asking the judge
 * and without interrupting the human. It carries a marker, so the
 * transcript shows a decision of the harness and not an answer of the human.
 *
 * The marker is a custom message of Pi. Pi removes the marker before the
 * provider sees the message, so the content of the refusal stays the
 * ordinary text of the answer.
 */

/**
 * The custom type of the message that the harness queues as a refusal.
 *
 * The prefix `harness:` is the convention of the harness for the messages
 * that it generates itself.
 */
export const HARNESS_LOCAL_REFUSAL_TYPE = "harness:local-refusal";

/**
 * The answer of a local refusal.
 *
 * The refusal is a "No" and nothing else: it is not an approval, and it is
 * not a continuation of the work.
 */
export const LOCAL_REFUSAL_ANSWER = "No";

/**
 * What the marker of a refusal carries.
 */
export interface LocalRefusalDetails {
	/** What the harness refused. */
	reason: string;
	/** The rule that refused. */
	rule: string;
}

/**
 * The shape of a message of Pi that the harness can recognize.
 */
export interface MaybeLocalRefusalMessage {
	role?: string;
	customType?: string;
	content?: unknown;
	display?: boolean;
	details?: unknown;
}

/**
 * The message that the harness queues as a refusal.
 */
export interface LocalRefusalMessage {
	role: "custom";
	customType: typeof HARNESS_LOCAL_REFUSAL_TYPE;
	content: string;
	display: boolean;
	details: LocalRefusalDetails;
}

/**
 * Is this message a refusal of the harness?
 *
 * Only the explicit marker counts. A message of the human that says "No"
 * is ordinary text and carries no rule.
 */
export function isLocalRefusalMessage(
	message: unknown,
): message is MaybeLocalRefusalMessage & {
	customType: typeof HARNESS_LOCAL_REFUSAL_TYPE;
} {
	if (message === null || typeof message !== "object") return false;
	const candidate = message as MaybeLocalRefusalMessage;
	return (
		candidate.role === "custom" &&
		candidate.customType === HARNESS_LOCAL_REFUSAL_TYPE
	);
}

/**
 * The message that the harness queues as a refusal.
 */
export function buildLocalRefusalMessage(input: {
	/** The answer of the refusal. */
	content?: string;
	/** What the harness refused. */
	reason: string;
	/** The rule that refused. */
	rule: string;
	/** Should the refusal be shown in the transcript? */
	display?: boolean;
}): LocalRefusalMessage {
	return {
		role: "custom",
		customType: HARNESS_LOCAL_REFUSAL_TYPE,
		content: input.content ?? LOCAL_REFUSAL_ANSWER,
		display: input.display ?? true,
		details: {
			reason: input.reason,
			rule: input.rule,
		},
	};
}
