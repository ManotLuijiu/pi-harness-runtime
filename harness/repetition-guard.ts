/**
 * The guard of a repeated output.
 *
 * A model that repeats one symbol over and over is not working: it fills
 * the context of the session with noise and stops. The guard sees the
 * output while it streams, stops the run before the budget of the
 * response is spent, keeps the tail of the noise out of the next context
 * of the model, and gives the request one bounded recovery.
 *
 * The rules of the guard:
 *
 * - the tail of the stream is examined, not the whole transcript,
 * - only a motif of characters that carry no letter repeats: a refrain of
 *   words is not a repetition, and a long run of marks or digits is,
 * - the repetition is marked before the run is stopped, so the state of
 *   the session knows that the stop was the guard and not the human,
 * - the tail of the noise is kept out of the next context, and the
 *   transcript of the session keeps it,
 * - one recovery is tried. A second repetition is not retried: the work
 *   stays open and the reason is shown.
 */

/**
 * How many times a motif has to repeat before the guard fires.
 */
export const REPETITION_MIN_REPEATS = 128;

/**
 * The longest tail the guard looks at.
 */
export const REPETITION_MAX_TAIL = 8_192;

/**
 * The longest motif the guard accepts.
 */
export const REPETITION_MAX_MOTIF = 4;

/**
 * What the guard found.
 */
export interface RepetitionFinding {
	/** The motif that repeats. */
	motif: string;
	/** How many times the motif repeats in the tail. */
	repeats: number;
	/** The text of the repetition. */
	tail: string;
}

/**
 * Is the character a letter?
 */
function isLetter(character: string): boolean {
	return /\p{L}/u.test(character);
}

/**
 * The motif that repeats at the end of the text.
 *
 * A motif of the repetition carries no letter: a word that repeats is a
 * refrain of a text, and a refrain is not a failure of the model.
 *
 * The marks and the digits of the ASCII are not a refrain: a long run of
 * them is the degeneration of the model. The table, the list and the
 * fence of an ordinary answer are short, and a run of a hundred
 * characters of the same kind is not a table.
 */
function motifAtEnd(text: string): { motif: string; repeats: number } | undefined {
	for (let length = 1; length <= REPETITION_MAX_MOTIF; length += 1) {
		if (text.length < length * REPETITION_MIN_REPEATS) continue;
		const motif = text.slice(-length);
		if ([...motif].some((character) => isLetter(character))) continue;
		if ([...motif].some((character) => /\s/u.test(character))) continue;
		let repeats = 0;
		let index = text.length;
		while (index >= length && text.slice(index - length, index) === motif) {
			repeats += 1;
			index -= length;
		}
		if (repeats >= REPETITION_MIN_REPEATS) return { motif, repeats };
	}
	return undefined;
}

/**
 * The detector of a repeated output.
 *
 * The detector keeps the tail of the stream and nothing else: the
 * transcript of the session holds the whole output.
 */
export class RepetitionDetector {
	private buffer = "";

	/**
	 * The text that was seen.
	 */
	push(chunk: string): RepetitionFinding | undefined {
		if (!chunk) return undefined;
		this.buffer += chunk;
		if (this.buffer.length > REPETITION_MAX_TAIL * 2) {
			this.buffer = this.buffer.slice(-REPETITION_MAX_TAIL);
		}
		const tail = this.buffer.slice(-REPETITION_MAX_TAIL);
		const motif = motifAtEnd(tail);
		if (!motif) return undefined;
		return {
			motif: motif.motif,
			repeats: motif.repeats,
			tail: tail.slice(-motif.motif.length * motif.repeats),
		};
	}

	/**
	 * The tail that was seen.
	 */
	tail(): string {
		return this.buffer.slice(-REPETITION_MAX_TAIL);
	}

	/**
	 * Forget the stream.
	 */
	reset(): void {
		this.buffer = "";
	}
}

/**
 * The state of a run that repeats itself.
 */
export interface GenerationLoopState {
	/** The session the run belongs to. */
	sessionId: string;
	/** The generation of the request the run belongs to. */
	requestGeneration: number;
	/** The id of the message that repeats itself. */
	messageId?: string;
	/** When the repetition was found. */
	detectedAt: number;
	/** What the guard found. */
	finding: RepetitionFinding;
	/** The recovery of the run was already tried. */
	recovered: boolean;
}

/**
 * The guard of the runs that repeat themselves.
 *
 * The state is marked before the run is stopped: a stop of the guard and
 * a stop of the human are two different things, and only the first one
 * may be recovered.
 */
export class GenerationLoopGuard {
	private state: GenerationLoopState | undefined;
	/**
	 * The findings of the run, one for every repetition.
	 *
	 * The findings are not one: a run that repeats itself, recovers and
	 * repeats itself again has two findings, and the noise of the first
	 * one belongs out of the context as well.
	 */
	private findings: Array<{
		sessionId: string;
		finding: RepetitionFinding;
	}> = [];

	/**
	 * The state of the run, if it is in one.
	 */
	current(): GenerationLoopState | undefined {
		return this.state;
	}

	/**
	 * The findings of the run.
	 */
	findingsOf(): ReadonlyArray<{
		sessionId: string;
		finding: RepetitionFinding;
	}> {
		return this.findings;
	}

	/**
	 * Mark the run before it is stopped.
	 */
	mark(input: {
		sessionId: string;
		requestGeneration: number;
		messageId?: string;
		finding: RepetitionFinding;
		now?: () => number;
	}): GenerationLoopState {
		const state: GenerationLoopState = {
			sessionId: input.sessionId,
			requestGeneration: input.requestGeneration,
			messageId: input.messageId,
			detectedAt: (input.now ?? Date.now)(),
			finding: input.finding,
			// The claim of the recovery belongs to the request: a run that
			// repeats itself again after its recovery is not recovered a
			// second time.
			recovered: this.state?.recovered ?? false,
		};
		this.state = state;
		this.findings.push({
			sessionId: input.sessionId,
			finding: input.finding,
		});
		return state;
	}

	/**
	 * Claim the one recovery of the run.
	 *
	 * The second call is refused: a repetition that survives a recovery is
	 * not retried forever.
	 */
	claimRecovery(): boolean {
		if (!this.state || this.state.recovered) return false;
		this.state = { ...this.state, recovered: true };
		return true;
	}

	/**
	 * The state of the run belongs to a request, and a new request is a
	 * new run: the state is dropped.
	 *
	 * The findings stay: they describe the noise of the transcript, and the
	 * transcript of the session keeps the noise after a new request of the
	 * human. The noise belongs out of the context of the next call of the
	 * model as well.
	 */
	resetRun(): void {
		this.state = undefined;
	}

	/**
	 * Forget everything.
	 *
	 * A new session has a new transcript: the noise of the old session is
	 * not in it.
	 */
	reset(): void {
		this.state = undefined;
		this.findings = [];
	}
}

/**
 * The text of a block of the content of a message.
 */
interface ContentBlock {
	text?: string;
}

/**
 * The content of a message, decoded.
 *
 * The content of a message of the context is a string or a list of
 * blocks. The decode happens once, at the boundary, so the rest of the
 * guard works with the shape it knows.
 */
type DecodedContent =
	| { kind: "text"; text: string }
	| { kind: "blocks"; blocks: ContentBlock[] }
	| { kind: "none" };

function decodeContent(content: unknown): DecodedContent {
	if (typeof content === "string") return { kind: "text", text: content };
	if (!Array.isArray(content)) return { kind: "none" };
	const blocks: ContentBlock[] = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const text = (block as { text?: unknown }).text;
		blocks.push(typeof text === "string" ? { text } : {});
	}
	return { kind: "blocks", blocks };
}

/**
 * The text of a message of the context.
 */
function textOf(message: ContextMessage): string {
	const content = decodeContent(message.content);
	if (content.kind === "text") return content.text;
	if (content.kind === "none") return "";
	return content.blocks
		.map((block) => block.text ?? "")
		.join("");
}

/**
 * A message of the context of a model.
 *
 * The harness does not need the whole shape of a message of Pi: it needs
 * the role and the content, and it has to keep the rest of the message.
 */
export interface ContextMessage {
	role?: string;
	content?: unknown;
	[key: string]: unknown;
}

/**
 * The message without the tail of the repetition.
 *
 * The message of the transcript keeps the noise. The context of the next
 * model call does not: the noise is replaced by a short line that says
 * what happened.
 */
export function withoutRepetitiveTail(
	message: ContextMessage,
	finding: RepetitionFinding,
): ContextMessage {
	const content = decodeContent(message.content);
	const note = `[the output of the model repeated ${finding.motif} ${finding.repeats} times and was stopped by the guard]`;
	if (content.kind === "text") {
		const at = content.text.lastIndexOf(finding.tail);
		if (at < 0) return message;
		return {
			...message,
			content: `${content.text.slice(0, at)}${note}${content.text.slice(at + finding.tail.length)}`,
		};
	}
	if (content.kind === "none") return message;
	const replaced = blocksWithoutTail(content.blocks, finding.tail, note);
	return replaced.changed ? { ...message, content: replaced.blocks } : message;
}

/**
 * The blocks without the tail of the repetition.
 *
 * The tail is normally the text of one block. The transcript of a session
 * can split the run of the noise over two blocks, and the noise belongs
 * out of the context in that case as well: the blocks are searched
 * together when no single block carries the whole tail.
 */
function blocksWithoutTail(
	blocks: ContentBlock[],
	tail: string,
	note: string,
): { blocks: ContentBlock[]; changed: boolean } {
	// The trailing noise is the noise of the finding: a message that
	// carries the same run twice keeps the first one, and the last one is
	// replaced. Only the last block that carries the tail is replaced, so
	// the rule is the rule of the text.
	let lastMatch = -1;
	blocks.forEach((block, index) => {
		const text = block.text;
		if (text === undefined) return;
		if (text.lastIndexOf(tail) >= 0) lastMatch = index;
	});
	if (lastMatch >= 0) {
		const simple = blocks.map((block, index) => {
			if (index !== lastMatch) return block;
			const text = block.text ?? "";
			const at = text.lastIndexOf(tail);
			return {
				...block,
				text: `${text.slice(0, at)}${note}${text.slice(at + tail.length)}`,
			};
		});
		return { blocks: simple, changed: true };
	}

	// The tail straddles two blocks: the run of the noise was split by the
	// transcript. The bounds of every block are known, so the part of the
	// tail that each block carries is known as well.
	const bounds: number[] = [];
	let offset = 0;
	for (const block of blocks) {
		offset += (block.text ?? "").length;
		bounds.push(offset);
	}
	const joined = blocks.map((block) => block.text ?? "").join("");
	const at = joined.lastIndexOf(tail);
	if (at < 0) return { blocks, changed: false };
	const start = at;
	const end = at + tail.length;
	let first = bounds.findIndex((bound) => start < bound);
	if (first < 0) first = blocks.length - 1;
	let last = bounds.findIndex((bound) => end <= bound);
	if (last < 0) last = blocks.length - 1;
	const across = blocks.map((block, index) => {
		const text = block.text;
		if (text === undefined) return block;
		if (index < first || index > last) return block;
		const blockStart = index === 0 ? 0 : bounds[index - 1];
		const from = Math.max(0, start - blockStart);
		const to = Math.min(text.length, end - blockStart);
		if (from >= to) return block;
		const note_ = index === first ? note : "";
		return { ...block, text: `${text.slice(0, from)}${note_}${text.slice(to)}` };
	});
	return { blocks: across, changed: true };
}

/**
 * The messages of a context without the tail of the repetition.
 *
 * Only the last message that carries the tail is changed: the rest of the
 * context is the context of the user.
 */
export function contextWithoutRepetitiveTail(
	messages: ContextMessage[],
	finding: RepetitionFinding,
): ContextMessage[] {
	const result = [...messages];
	for (let index = result.length - 1; index >= 0; index -= 1) {
		const message = result[index];
		if (!textOf(message).includes(finding.tail)) continue;
		result[index] = withoutRepetitiveTail(message, finding);
		break;
	}
	return result;
}

/**
 * The text of a delta of the stream of Pi.
 *
 * Pi streams the answer of the model in deltas. Only the text of the
 * answer is the output that repeats itself: the thinking of the model and
 * the arguments of a tool call are not an answer, and a table of a tool
 * call may well repeat a sign.
 *
 * A delta of another kind carries no text, and the guard is not fed with
 * it.
 */
export function textDeltaOf(event: unknown): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const delta = (event as { type?: unknown; delta?: unknown }).type === "text_delta"
		? (event as { delta?: unknown }).delta
		: undefined;
	if (typeof delta !== "string") return undefined;
	return delta.length > 0 ? delta : undefined;
}

/**
 * Who stopped the run?
 *
 * A guard that stops a run and a human that stops a run are two different
 * things. The guard is the harness itself, and the human is the human: the
 * recovery of a repetition is allowed after the guard stopped a run, and it
 * is not allowed after the human stopped it.
 *
 * The guard wins when the run was stopped by the guard: the signal of the
 * run does not say who stopped it, and the human and the guard share it.
 * A human that stops the run at the same moment as the guard is not
 * recognized here: the harness cannot tell the two apart.
 */
export function classifyRunStop(input: {
	/** The guard of the repetition stopped the run. */
	stoppedByGuard: boolean;
	/** The reason the run ended, as Pi reports it. */
	stopReason?: unknown;
	/** The signal of the run was aborted. */
	signalAborted?: boolean;
}): "guard" | "human" | "none" {
	const aborted =
		input.stopReason === "aborted" || input.signalAborted === true;
	if (!aborted) return "none";
	return input.stoppedByGuard ? "guard" : "human";
}
