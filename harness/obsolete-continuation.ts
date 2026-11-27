/**
 * The consumption of an obsolete continuation.
 *
 * A continuation that was queued while a request ran can be consumed after
 * that request finished. It must not reach the provider then: the agent
 * would be asked to acknowledge a control message, and the answer of the
 * agent is a new turn that can queue another continuation.
 *
 * Pi 1.6.1 offers no selective cancellation of a queued message. The
 * supported boundary is the "context" event: it runs before the provider
 * is called and the handler may replace the messages. The obsolete
 * continuation is removed from the messages, and the run is aborted when
 * nothing of the human follows it - a run that only carried the obsolete
 * continuation costs no provider call.
 *
 * A request of the human is never cancelled by the cleanup of an older
 * one: a human message after the continuation keeps the run alive.
 */

/** The shape of a message that the consumption reads. */
interface MaybeMessage {
	role?: string;
	content?: unknown;
}

/** The outcome of the consumption of an obsolete continuation. */
export interface ContinuationConsumption {
	/** The messages without the obsolete continuation. */
	messages: unknown[];
	/** May the run be aborted, so that no provider call happens? */
	abort: boolean;
	/** Why the run is (not) aborted. */
	reason: string;
}

/** The input of the consumption. */
export interface ConsumeContinuationInput {
	/** The messages of the run. */
	messages: readonly unknown[] | null | undefined;
	/** The index of the obsolete continuation. */
	index: number;
	/**
	 * Is this text a message of the harness?
	 *
	 * A message of the harness that was neutralized earlier is a user
	 * message in the history, and it is not a request of the human.
	 */
	isHarnessText?: (text: string) => boolean;
}

/**
 * The text of a message.
 */
function messageText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const candidate = message as MaybeMessage;
	if (typeof candidate.content === "string") return candidate.content;
	if (Array.isArray(candidate.content)) {
		return candidate.content
			.map((part) => {
				if (!part || typeof part !== "object") return "";
				const entry = part as { type?: string; text?: string };
				return entry.type === "text" ? (entry.text ?? "") : "";
			})
			.join("\n");
	}
	return "";
}

/**
 * Is there a request of the human after the obsolete continuation?
 *
 * The messages of the harness are not requests of the human: a neutralized
 * continuation of an earlier run is a user message in the history, and it
 * never counts as a request.
 */
export function hasHumanRequestAfter(
	messages: readonly unknown[] | null | undefined,
	index: number,
	isHarnessText?: (text: string) => boolean,
): boolean {
	if (!Array.isArray(messages)) return false;
	for (let at = index + 1; at < messages.length; at += 1) {
		const message = messages[at] as MaybeMessage | null;
		if (!message || message.role !== "user") continue;
		const text = messageText(message).trim();
		if (!text) continue;
		if (isHarnessText?.(text)) continue;
		return true;
	}
	return false;
}

/**
 * Consume an obsolete continuation.
 *
 * The continuation is removed from the messages, so it never reaches the
 * provider. The run is aborted when it carried nothing else: an abort
 * stops the provider call, so the completion of a request costs no turn.
 * A request of the human after the continuation keeps the run alive.
 */
export function consumeObsoleteContinuation(
	input: ConsumeContinuationInput,
): ContinuationConsumption {
	const messages = Array.isArray(input.messages) ? input.messages : [];
	const { index } = input;
	if (index < 0 || index >= messages.length) {
		return {
			messages: [...messages],
			abort: false,
			reason: "there is no obsolete continuation to consume",
		};
	}
	const remaining = messages.filter((_, at) => at !== index);
	const human = hasHumanRequestAfter(messages, index, input.isHarnessText);
	if (human) {
		return {
			messages: remaining,
			abort: false,
			reason:
				"a request of the human follows the continuation; the run goes on",
		};
	}
	return {
		messages: remaining,
		abort: true,
		reason: "the run carried the obsolete continuation only",
	};
}
