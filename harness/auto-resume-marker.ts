/**
 * The marker of an automatic resume.
 *
 * An automatic resume is a message of the harness, not a message of the
 * human. It carries a marker, so the harness can recognize it later: a
 * resume that was queued while the request ran and that is consumed after
 * the request finished must not send the agent to the backlog.
 *
 * The marker is a custom message of Pi. Pi removes the marker before the
 * provider sees the message, so the content of the resume stays the
 * ordinary text of the resume.
 */

/**
 * The custom type of the message that the harness queues as a resume.
 *
 * The prefix `harness:` is the convention of the harness for the messages
 * that it generates itself: every path that skips the traffic of the
 * harness recognizes it.
 */
export const HARNESS_AUTO_RESUME_TYPE = "harness:auto-resume";

/**
 * What a resume continues.
 *
 * A resume of the request continues the request that is running. A resume
 * of a turn continues a turn that was cut off, which is unfinished by
 * definition. A scope that cannot be read is unknown: the harness does not
 * know what the resume continues, and it does not act on it.
 */
export type AutoResumeScope = "request" | "turn" | "unknown";

/** What the marker of a resume carries. */
export interface AutoResumeDetails {
	/** Why the resume was queued. */
	reason: string;
	/** What the resume continues. */
	scope: AutoResumeScope;
	/** A nonce that tells this resume from another one. */
	nonce: string;
	/**
	 * The request the resume belongs to.
	 *
	 * The generation of the request is its identity. A resume of a request
	 * that the human replaced must not continue the old work inside the
	 * new request, and only the identity tells the two apart.
	 */
	requestGeneration?: number;
}

/** The shape of a message of Pi that the harness can recognize. */
export interface MaybeAutoResumeMessage {
	role?: string;
	customType?: string;
	content?: unknown;
	display?: boolean;
	details?: unknown;
}

/**
 * A message that carries the marker of the harness.
 *
 * The marker is the proof; the details are read from it when they are
 * usable, and a marker without details is still a marker.
 */
export interface AutoResumeCarrier {
	role: "custom";
	customType: typeof HARNESS_AUTO_RESUME_TYPE;
	content?: unknown;
	display?: boolean;
	details?: unknown;
}

/** The message that the harness queues as a resume. */
export interface AutoResumeMessage {
	role: "custom";
	customType: typeof HARNESS_AUTO_RESUME_TYPE;
	content: string;
	display: boolean;
	details: AutoResumeDetails;
}

/**
 * Is this message the resume of the harness?
 *
 * Only the explicit marker counts. A message of the human that says
 * "resume" is ordinary text and authorizes nothing.
 */
export function isAutoResumeMessage(
	message: unknown,
): message is AutoResumeCarrier {
	if (message === null || typeof message !== "object") return false;
	const candidate = message as MaybeAutoResumeMessage;
	return (
		candidate.role === "custom" &&
		candidate.customType === HARNESS_AUTO_RESUME_TYPE
	);
}

/**
 * The details of a resume, when the message carries them.
 *
 * The reason and the scope are read apart from each other: a marker
 * without a usable reason still says what the resume continues, and a
 * marker without a usable scope is not a resume of the request.
 */
export function autoResumeDetails(
	message: unknown,
): AutoResumeDetails | undefined {
	if (!isAutoResumeMessage(message)) return undefined;
	const details = message.details;
	if (details === null || typeof details !== "object") return undefined;
	const candidate = details as Partial<AutoResumeDetails>;
	const scope: AutoResumeScope =
		candidate.scope === "request" ||
		candidate.scope === "turn" ||
		candidate.scope === "unknown"
			? candidate.scope
			: "unknown";
	const reason =
		typeof candidate.reason === "string" ? candidate.reason : undefined;
	if (reason === undefined && scope === "unknown") return undefined;
	return {
		reason: reason ?? "auto-resume",
		scope,
		nonce: typeof candidate.nonce === "string" ? candidate.nonce : "",
		requestGeneration:
			typeof candidate.requestGeneration === "number" &&
			Number.isFinite(candidate.requestGeneration)
				? candidate.requestGeneration
				: undefined,
	};
}

/**
 * The index of the resume in the messages, or -1 when there is none.
 *
 * The last resume wins: it is the one that is consumed.
 */
export function findAutoResumeIndex(
	messages: readonly unknown[] | null | undefined,
): number {
	if (!Array.isArray(messages)) return -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (isAutoResumeMessage(messages[index])) return index;
	}
	return -1;
}

/** The message that the harness queues as a resume. */
export function buildAutoResumeMessage(input: {
	content: string;
	reason: string;
	scope: "request" | "turn";
	nonce: string;
	/** The request the resume belongs to. */
	requestGeneration?: number;
}): AutoResumeMessage {
	return {
		role: "custom",
		customType: HARNESS_AUTO_RESUME_TYPE,
		content: input.content,
		display: false,
		details: {
			reason: input.reason,
			scope: input.scope,
			nonce: input.nonce,
			requestGeneration: input.requestGeneration,
		},
	};
}

/**
 * The text that replaces a resume of a request that is already complete.
 *
 * It states the truth and asks for nothing: the turn ends, and no work is
 * started, continued or expanded.
 */
export const NEUTRALIZED_RESUME_TEXT = [
	"The request of the user is already complete.",
	"There is no work left to continue.",
	"Do not start, resume or expand any work, and do not look for other tasks.",
	"Answer with one short sentence that says the request is complete.",
].join(" ");

/**
 * The text that replaces a resume of a request that the human replaced.
 *
 * The request of the resume is not the request that is running: the human
 * has moved on, and the resume must not continue the old work.
 */
export const NEUTRALIZED_STALE_RESUME_TEXT = [
	"The request that this automatic resume belongs to was replaced by a newer request.",
	"Do not continue, resume or expand that older work, and do not look for other tasks.",
	"Answer with one short sentence that says the newer request is the one that counts.",
].join(" ");

/**
 * Replace a resume of a completed request with a message that stops the turn.
 *
 * The array keeps a valid ending: the message that replaces the resume is
 * a user message, so the call of the provider stays well formed. The
 * messages that are not the resume are not touched.
 */
export function neutralizeAutoResume(
	messages: readonly unknown[] | null | undefined,
	index: number,
	text: string = NEUTRALIZED_RESUME_TEXT,
): unknown[] {
	if (!Array.isArray(messages)) return [];
	if (index < 0 || index >= messages.length) return [...messages];
	const replaced = [...messages];
	replaced[index] = {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
	return replaced;
}
