/**
 * The capture of the work of a request.
 *
 * A request of the human names work: a request that asks for two things
 * asks for two items in the task list. The reminder of the task list used
 * to look at the list alone, so one item silenced the reminder about the
 * work that the other items stood for.
 *
 * This module reads the steps of a request and reconciles them with the
 * task list. The work that has no item is named, so the reminder can name
 * it and the agent can record it.
 *
 * The reading of the request is deterministic. The decomposition of a
 * request into steps is a question of meaning, and a meaning that is
 * guessed wrong is worse than no decomposition at all: a reminder that
 * asks for a step the request never named is noise, and noise is what
 * makes an agent ignore the reminder.
 */

/**
 * The shape of a todo that the capture reads.
 */
export interface CaptureTodo {
	/** The subject of the todo. */
	subject?: string;
	/** The description of the todo. */
	description?: string;
	/** The state of the todo. */
	status?: string;
}

/**
 * The words that greet and close a conversation.
 *
 * They are not the work of a request. A message that holds nothing but a
 * greeting has no step, and a reminder about it would be noise.
 */
const SOCIAL_WORDS = new Set([
	"awesome",
	"bye",
	"cool",
	"done",
	"good",
	"goodbye",
	"great",
	"hello",
	"hey",
	"hi",
	"nice",
	"ok",
	"okay",
	"perfect",
	"right",
	"thank",
	"thanks",
	"thx",
	"welcome",
	"yeah",
	"yep",
]);

/**
 * The words that carry no meaning for the match.
 *
 * They are the words that every sentence has, so they tell nothing about
 * whether a step and an item are about the same work.
 */
const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"but",
	"by",
	"can",
	"do",
	"does",
	"for",
	"from",
	"has",
	"have",
	"how",
	"i",
	"in",
	"into",
	"is",
	"it",
	"its",
	"me",
	"my",
	"of",
	"on",
	"or",
	"our",
	"please",
	"should",
	"so",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"they",
	"this",
	"to",
	"us",
	"was",
	"we",
	"were",
	"what",
	"when",
	"which",
	"who",
	"will",
	"with",
	"would",
	"you",
	"your",
]);

/**
 * The words that start a clause that continues the previous one.
 *
 * A clause that starts with one of them is not a step of its own: it says
 * something about the step before it.
 */
const CONTINUATION_WORDS = new Set([
	"because",
	"but",
	"since",
	"so",
	"that",
	"which",
	"while",
	"who",
	"whose",
	"and",
	"then",
	"also",
	"plus",
	"however",
	"otherwise",
]);

/**
 * The words that end a clause of the request.
 *
 * The list is small on purpose. A request is a sentence with a few
 * actions in it, and a request that is cut into more pieces than it has
 * produces steps that do not exist.
 */
const CLAUSE_SEPARATORS =
	/\s*(?:;|\n+|\band then\b|\band also\b|\band after that\b|, and |, then |, also | and |, )\s*/i;

/**
 * The words of a text that carry its meaning.
 */
export function contentWords(text: string | undefined): string[] {
	const words = (text ?? "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 0);
	const kept: string[] = [];
	for (const word of words) {
		if (STOP_WORDS.has(word)) continue;
		if (SOCIAL_WORDS.has(word)) continue;
		if (word.length < 2) continue;
		kept.push(word);
	}
	return kept;
}

/**
 * The steps of a request.
 *
 * A step is a clause of the request that carries meaning of its own. A
 * clause that continues the one before it is not a step, and a clause
 * without meaning is not a step either.
 */
export function stepsOfRequest(text: string | undefined): string[] {
	const value = (text ?? "").trim();
	if (value.length === 0) return [];
	const clauses = value
		.split(CLAUSE_SEPARATORS)
		.map((clause) =>
			clause
				.trim()
				.replace(/[.!?]+$/, "")
				.trim(),
		)
		.filter((clause) => clause.length > 0);
	const steps: string[] = [];
	for (const clause of clauses) {
		const first = clause.split(/\s+/)[0]?.toLowerCase() ?? "";
		// A clause that continues the previous one is not a step.
		if (CONTINUATION_WORDS.has(first)) continue;
		// A clause without meaning is not a step.
		if (contentWords(clause).length === 0) continue;
		if (!steps.includes(clause)) steps.push(clause);
	}
	return steps;
}

/**
 * The steps that no item of the task list covers.
 *
 * A step is covered when an item of the list is about the same work: the
 * words of the step that carry meaning appear in the item. The share that
 * has to match is high enough that an item about other work does not
 * cover the step, and low enough that an item that names the step in
 * more words still covers it.
 */
export function uncoveredSteps(
	steps: string[],
	todos: CaptureTodo[] | undefined,
): string[] {
	if (!Array.isArray(steps) || steps.length === 0) return [];
	if (!Array.isArray(todos)) return [...steps];
	const items = todos.map((todo) =>
		contentWords(`${todo?.subject ?? ""} ${todo?.description ?? ""}`),
	);
	const missing: string[] = [];
	for (const step of steps) {
		const words = contentWords(step);
		if (words.length === 0) continue;
		const covered = items.some((wordsOfItem) => {
			if (wordsOfItem.length === 0) return false;
			const shared = words.filter((word) => wordsOfItem.includes(word)).length;
			return shared / words.length >= 0.6;
		});
		if (!covered) missing.push(step);
	}
	return missing;
}

/**
 * The instruction that asks the agent to record the work of a request.
 *
 * The instruction names the request and the steps that have no item, so
 * the agent knows what to record. A generic instruction that asks for
 * "all tasks" is not enough: the agent does not know which tasks are
 * meant, and the work it leaves out is the work that is lost.
 */
export function captureInstruction(
	request: string | undefined,
	missing: string[],
	todoToolName = "todo",
): string {
	const lines: string[] = [
		"The task list of this session does not hold the work of this request.",
	];
	if (request && request.trim().length > 0) {
		lines.push(`This request is the work to record: ${request.trim()}`);
	}
	if (missing.length > 0) {
		lines.push(
			`These steps of it have no item in the task list yet: ${missing.join(
				"; ",
			)}`,
		);
	}
	lines.push(
		`Use ${todoToolName} (the local Todos list, not bd). Read the pending and the in_progress`,
		"items first; reuse the existing items and avoid duplicates. Add one item per",
		"missing step, the subject in the imperative, and the description with what the",
		"step is and how it is checked. Update progress, blockers and the exact next",
		"action, and mark an item completed only when its required validation has",
		"passed. Do not start unrelated backlog work.",
		"The task list is what survives a full context window: without it the work",
		"of this request is lost when the window fills.",
	);
	return lines.join(" ");
}
