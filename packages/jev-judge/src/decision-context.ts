/**
 * The decision context of a choice question.
 *
 * A choice is only decidable when the evaluation sees what the alternatives
 * MEAN. The detection layer extracts short labels ("implement A", "A+B"), and
 * a label alone does not carry the meaning, the caveats or the boundaries of
 * an option. This module is the single place where the runtime turns the
 * source message into the facts of a decision.
 *
 * The rules of the module:
 *
 * - Structured facts supplied by the agent win over extracted ones.
 * - Extracted text is verbatim: negation, dependencies and caveats are kept
 *   as they were written, never paraphrased into something weaker.
 * - Nothing here decides: the module never selects an option and never
 *   invents an approval. Missing information is surfaced as an uncertainty
 *   so that a wait outcome stays possible.
 * - Every bound is declared and every cut is reported, so a reader can tell
 *   what the evaluation did not see.
 */

/** How many options reach the evaluation. */
export const MAX_CHOICE_OPTIONS = 10;
/** How much of the problem statement reaches the evaluation. */
export const MAX_PROBLEM_CHARS = 600;
/** How much of the question reaches the evaluation. */
export const MAX_CHOICE_QUESTION_CHARS = 600;
/** How much of one option description reaches the evaluation. */
export const MAX_OPTION_DESCRIPTION_CHARS = 600;
/** How many tradeoffs or constraints per option reach the evaluation. */
export const MAX_OPTION_FACTS = 6;
/** How much of one fact (a tradeoff, a constraint) reaches the evaluation. */
export const MAX_OPTION_FACT_CHARS = 400;
/** How much of the rendered excerpt reaches the evaluation. */
export const MAX_CHOICE_EXCERPT_CHARS = 2000;
/** How much of one criterion reaches the evaluation. */
export const MAX_OPTION_CRITERION_CHARS = 400;
/**
 * How far into a paragraph a name of an option is looked for.
 *
 * A paragraph that names an option in its first line talks about that
 * option; a paragraph that names it much later talks about something else.
 */
export const MENTION_WINDOW_CHARS = 80;

/** One option of a choice, with the facts the evaluation needs. */
export interface ChoiceOptionFacts {
	/** The stable id of the option: `option_1`, `option_2`, ... */
	id: string;
	/** The label the agent offered, unchanged. */
	label: string;
	/** What the option means, or an empty string when the source does not say. */
	description: string;
	/** What the option costs or changes. */
	tradeoffs: string[];
	/** What restricts the option, kept verbatim. */
	constraints: string[];
}

/** The facts of a decision about a choice. */
export interface ChoiceDecisionContext {
	/** The problem the choice is about. */
	problem: string;
	/** The question the agent asked. */
	question: string;
	/** The options, with stable ids. */
	options: ChoiceOptionFacts[];
	/** What is authorized, and what is not. */
	authorization: {
		approved: string[];
		notEstablished: string[];
	};
	/** What could not be established from the source. */
	uncertainties: string[];
	/** The provenance of the facts and the completeness signal. */
	source: {
		/** How long the source message is. */
		originalChars: number;
		/** Whether a bound cut something away. */
		truncated: boolean;
		/** What the evaluation does not see. */
		omittedInformation: string[];
		/** Where the facts came from. */
		derived: "structured" | "extracted" | "mixed";
		/** Whether every option carries its meaning. */
		complete: boolean;
	};
}

/** One option as the agent supplied it. */
type StructuredOption = NonNullable<StructuredChoiceFacts["options"]>[number];

/** The facts the agent supplied itself. They win over extracted ones. */
export interface StructuredChoiceFacts {
	/** The problem the choice is about. */
	problem?: string;
	/** The options, with their meaning. */
	options?: Array<{
		id?: string;
		label?: string;
		description?: string;
		tradeoffs?: string[];
		constraints?: string[];
	}>;
	/** What a human authorized, and what nobody authorized. */
	authorization?: {
		approved?: string[];
		notEstablished?: string[];
	};
	/** What the agent itself could not establish. */
	uncertainties?: string[];
}

/** The input of the helper. */
export interface ChoiceContextInput {
	/** The question the agent asked. */
	question: string;
	/** The alternatives the detection layer extracted. */
	alternatives: string[];
	/** The complete assistant message the question was detected in. */
	contextText?: string;
	/** Facts supplied by the agent. */
	structured?: StructuredChoiceFacts;
	/**
	 * Whether the earlier turns of the conversation were available.
	 *
	 * The runtime usually has only the message the question was detected in.
	 * The difference between "the context is in this message" and "the
	 * context was in an earlier message" has to stay visible, so the default
	 * is "not supplied" and it is reported as missing.
	 */
	history?: { available: boolean; note?: string };
}

/** The parts of an option that the extraction found in the source message. */
export interface ExtractedOption {
	description: string;
	tradeoffs: string[];
	constraints: string[];
	/** Whether the source stated what the option means. */
	found: boolean;
	/** The line of the header the facts were found at, -1 when there was none. */
	headerIndex: number;
}

/** What the extraction needs to know about one option. */
export interface OptionExtractionInput {
	/** The complete assistant message. */
	source: string;
	/** The tokens that can locate the header of the option. */
	headerCandidates: string[];
	/** The tokens that name the option in prose. */
	mentionAnchors: string[];
	/** The header candidates of the other options. */
	otherHeaderCandidates: string[];
	/** The mention anchors of the other options. */
	otherMentionAnchors: string[];
	/** The header lines that other options already own. */
	claimed: Set<number>;
	/** The question, so that the region ends where the question begins. */
	question: string;
}

/** A paragraph of the source message. */
interface Paragraph {
	text: string;
	/** Where the paragraph starts in the source message. */
	start: number;
}

/**
 * Normalize a label for a comparison: case and spacing do not change what a
 * label means, but a different label is a different option.
 */
function normalizeLabel(label: string): string {
	return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The primary tokens of a label: the short uppercase ones.
 *
 * "implement A" has the primary "A", "A+B" has the primary "A+B".
 */
export function derivePrimaryAnchors(label: string): string[] {
	const tokens = label
		.split(/\s+/)
		.map((token) => token.replace(/^[^\w+]+/, "").replace(/[^\w+]+$/, ""))
		.filter((token) => token.length > 0);
	if (tokens.length === 0) return [];

	const upper = tokens.filter(
		(token) =>
			/^[A-Z0-9+]{1,6}$/.test(token) &&
			/[A-Z0-9]/.test(token) &&
			token !== token.toLowerCase(),
	);
	if (upper.length === 0) {
		return [tokens[tokens.length - 1] as string];
	}
	return upper;
}

/**
 * The primary anchor of an option: the token that names it.
 */
export function deriveOptionAnchor(label: string): string {
	return derivePrimaryAnchors(label)[0] ?? "";
}

/**
 * The tokens that can name an option in the source message.
 *
 * A combination like "A+B" also names its parts, because the message writes
 * the second part as its own header ("**B. ...**").
 */
export function deriveOptionAnchors(label: string): string[] {
	const anchors: string[] = [];
	for (const token of derivePrimaryAnchors(label)) {
		if (!anchors.includes(token)) anchors.push(token);
		for (const part of token.split("+")) {
			if (part.length > 0 && !anchors.includes(part)) anchors.push(part);
		}
	}
	return anchors;
}

/**
 * The tokens that name an option in prose.
 *
 * A part of a combination is dropped when it is the primary token of
 * another option: in "implement A" against "A+B", the "A" belongs to the
 * first option, and the second option is named by "A+B" and "B".
 *
 * A token that does not look like an identifier ("so" in "make it so") never
 * becomes a mention anchor: a common word would make every paragraph that
 * contains it a fact of the option.
 */
function deriveMentionAnchors(
	primaries: string[],
	otherPrimaries: string[],
): string[] {
	const anchors: string[] = [];
	for (const token of primaries) {
		if (!isIdentifierToken(token)) continue;
		if (!anchors.includes(token)) anchors.push(token);
		for (const part of token.split("+")) {
			if (part.length === 0) continue;
			if (!isIdentifierToken(part)) continue;
			if (otherPrimaries.includes(part)) continue;
			if (!anchors.includes(part)) anchors.push(part);
		}
	}
	return anchors;
}

/**
 * Whether a token names something: it carries a capital letter or a digit.
 */
function isIdentifierToken(token: string): boolean {
	return /[A-Z0-9]/.test(token) && token !== token.toLowerCase();
}

/**
 * Split the source message into paragraphs.
 *
 * A paragraph is a block of text separated by an empty line. The position of
 * every paragraph is kept, so a fact can be pointed at.
 */
function splitParagraphs(source: string): Paragraph[] {
	const paragraphs: Paragraph[] = [];
	const pattern = /\S[\s\S]*?(?=\n\s*\n|$)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(source)) !== null) {
		const text = match[0].trim();
		if (text.length > 0) {
			paragraphs.push({ text, start: match.index });
		}
	}
	return paragraphs;
}

/** The characters that end the anchor of an option header. */
const HEADER_SEPARATORS = [".", ":", ")", "-", "–", "—"];

function isWordCharacter(character: string): boolean {
	return /[A-Za-z0-9]/.test(character);
}

/**
 * Whether a line is the header of an option: the line starts with the
 * anchor, followed by a separator.
 *
 * The anchor comes from the text of the agent, so the check is a string
 * comparison and never a pattern built from that text.
 */
function isOptionHeader(line: string, anchor: string): boolean {
	if (anchor.length === 0) return false;
	const stripped = line.replace(/^\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*/, "");
	if (!stripped.startsWith(anchor)) return false;
	const next = stripped.charAt(anchor.length);
	if (next === "") return true;
	if (isWordCharacter(next)) return false;
	return HEADER_SEPARATORS.includes(next);
}

/** Whether a line mentions the anchor as a word. */
function mentionsAnchor(line: string, anchor: string): boolean {
	if (anchor.length === 0) return false;
	let from = 0;
	for (;;) {
		const index = line.indexOf(anchor, from);
		if (index === -1) return false;
		const before = index > 0 ? line.charAt(index - 1) : "";
		const after = line.charAt(index + anchor.length);
		if (
			(before === "" || !isWordCharacter(before)) &&
			(after === "" || !isWordCharacter(after))
		) {
			return true;
		}
		from = index + 1;
	}
}

/** Strip the markdown markers of a heading or a bold label. */
function stripMarkdown(value: string): string {
	return value
		.replace(/^\s*(?:[-*+]\s+)+/, "")
		.replace(/(\*\*|__|`)/g, "")
		.trim();
}

/**
 * Remove the anchor of an option from the beginning of its description, so
 * the description starts with the meaning and not with the label.
 */
function stripLeadingAnchor(text: string, anchor: string): string {
	const stripped = text.replace(/^\s*(?:\*\*|__)?\s*/, "");
	if (anchor.length === 0 || !stripped.startsWith(anchor)) return stripped;
	const next = stripped.charAt(anchor.length);
	if (next !== "" && isWordCharacter(next)) return stripped;
	return stripped.slice(anchor.length).replace(/^[.:)\-–—\s]+/, "").trim();
}

/**
 * A paragraph states a restriction when it names a duty, a prohibition or a
 * condition. The markers are conservative: a paragraph that is not
 * recognized is a consequence, not a restriction.
 */
function statesConstraint(paragraph: string): boolean {
	return (
		/^\s*(caveat|caveats?|careful|note|warning|constraint|constraints?|however|but|instead|only if|never|must|do not|don't|cannot|can't)\b/i.test(
			paragraph,
		) ||
		/\b(must|never|cannot|can not|only if|is required to|has to|not just)\b/i.test(
			paragraph,
		)
	);
}

/**
 * Whether a text mentions an anchor as a word.
 */
function mentionsAny(text: string, anchors: string[]): boolean {
	return anchors.some((anchor) => mentionsAnchor(text, anchor));
}

/**
 * Whether a paragraph is a fact of one option.
 *
 * The paragraph has to name the option near its beginning, and it must not
 * name another option there: a paragraph about two options says something
 * about both, and it belongs to neither of them alone.
 */
function belongsToOption(
	text: string,
	ownAnchors: string[],
	otherAnchors: string[],
): boolean {
	const window = text.slice(0, MENTION_WINDOW_CHARS);
	if (!mentionsAny(window, ownAnchors)) return false;
	return !mentionsAny(window, otherAnchors);
}

/**
 * The line of the header of an option.
 *
 * The candidates are tried in order, and a header that another option
 * already claims is skipped: the label "A+B" must not land on the header of
 * the option "A".
 */
function locateHeader(
	lines: string[],
	candidates: string[],
	claimed: Set<number>,
): number {
	for (const candidate of candidates) {
		for (let index = 0; index < lines.length; index += 1) {
			if (claimed.has(index)) continue;
			if (isOptionHeader(lines[index] as string, candidate)) return index;
		}
	}
	return -1;
}

/**
 * Extract the facts of one option from the source message.
 *
 * The extraction is anchored on the option header, not on the beginning of
 * the message: a decisive caveat that stands behind the two thousandth
 * character of the message is as much a part of the option as the sentence
 * in front of it.
 *
 * A paragraph belongs to an option when it names that option and no other.
 * A paragraph that names two options says something about both, and it is
 * left out instead of being filed under one of them.
 */
export function extractOptionFacts(
	input: OptionExtractionInput,
): ExtractedOption {
	const {
		source,
		headerCandidates,
		mentionAnchors,
		otherHeaderCandidates,
		otherMentionAnchors,
		claimed,
		question,
	} = input;
	const empty: ExtractedOption = {
		description: "",
		tradeoffs: [],
		constraints: [],
		found: false,
		headerIndex: -1,
	};
	if (headerCandidates.length === 0 || source.length === 0) return empty;

	const lines = source.split("\n");
	const headerIndex = locateHeader(lines, headerCandidates, claimed);

	const paragraphs = splitParagraphs(source);
	let description = "";
	let region: Paragraph[] = [];

	if (headerIndex >= 0) {
		// The region of the option ends at the next option header, at the
		// next heading of the message, or at the question itself.
		const regionLines: string[] = [];
		const questionMarker = question.trim().slice(0, 40);
		for (let index = headerIndex; index < lines.length; index += 1) {
			const line = lines[index] as string;
			if (index > headerIndex) {
				if (/^\s*#{1,6}\s/.test(line)) break;
				if (questionMarker.length > 0 && line.includes(questionMarker)) break;
				if (
					otherHeaderCandidates.some((other) =>
						isOptionHeader(line, other),
					)
				) {
					break;
				}
			}
			regionLines.push(line);
		}
		region = splitParagraphs(regionLines.join("\n"));
		if (region.length > 0) {
			const anchor =
				headerCandidates.find((candidate) =>
					isOptionHeader(lines[headerIndex] as string, candidate),
				) ?? (headerCandidates[0] as string);
			description = stripMarkdown(
				stripLeadingAnchor((region[0] as Paragraph).text, anchor),
			);
		}
	} else {
		// No header: the first paragraph that names the option and no other
		// one carries its meaning.
		const own = region;
		const candidate = paragraphs.find((paragraph) =>
			belongsToOption(
				paragraph.text,
				mentionAnchors,
				otherMentionAnchors,
			),
		);
		if (candidate) {
			const anchor =
				mentionAnchors.find((token) =>
					mentionsAnchor(candidate.text.slice(0, MENTION_WINDOW_CHARS), token),
				) ?? (mentionAnchors[0] as string);
			description = stripMarkdown(stripLeadingAnchor(candidate.text, anchor));
			region = own;
		}
	}

	const tradeoffs: string[] = [];
	const constraints: string[] = [];
	const addFact = (text: string): void => {
		const value = stripMarkdown(text);
		if (value.length === 0) return;
		if (!belongsToOption(value, mentionAnchors, otherMentionAnchors)) return;
		if (statesConstraint(value)) {
			if (!constraints.includes(value)) constraints.push(value);
		} else if (!tradeoffs.includes(value)) {
			tradeoffs.push(value);
		}
	};

	// The paragraphs of the region after the description.
	for (const paragraph of region.slice(1)) {
		addFact(paragraph.text);
	}

	// A caveat that names the option belongs to the option, even when it
	// stands outside the region: "Caveat for B: ..." is about B.
	const regionStart = region[0]?.start ?? Number.MAX_SAFE_INTEGER;
	for (const paragraph of paragraphs) {
		if (paragraph.start <= regionStart) continue;
		addFact(paragraph.text);
	}

	return {
		description,
		tradeoffs,
		constraints,
		found: description.length > 0,
		headerIndex,
	};
}

/**
 * The paragraph of the source message that stands directly before the
 * question: it states the problem the question is about.
 */
function extractProblem(source: string, question: string): string {
	if (source.length === 0) return "";
	const questionIndex = question.length > 0 ? source.indexOf(question) : -1;
	if (questionIndex > 0) {
		const before = source.slice(0, questionIndex);
		const paragraphs = splitParagraphs(before);
		const last = paragraphs[paragraphs.length - 1];
		if (last) return stripMarkdown(last.text);
	}
	const paragraphs = splitParagraphs(source);
	const first = paragraphs[0];
	return first ? stripMarkdown(first.text) : "";
}

/**
 * Build the decision context of a choice question.
 *
 * The function never decides and never authorizes: it prepares the facts
 * that a decision is made of, and it names what it could not establish.
 */
export function buildChoiceDecisionContext(
	input: ChoiceContextInput,
): ChoiceDecisionContext {
	const omitted: string[] = [];
	const uncertainties: string[] = [];
	const structured = input.structured ?? {};
	const structuredOptions = Array.isArray(structured.options)
		? structured.options
		: [];

	// The question itself.
	let question = input.question.trim();
	if (question.length > MAX_CHOICE_QUESTION_CHARS) {
		question = question.slice(0, MAX_CHOICE_QUESTION_CHARS);
		omitted.push(
			`the question was cut at ${MAX_CHOICE_QUESTION_CHARS} characters`,
		);
	}

	// The alternatives, with their stable ids.
	const allAlternatives = input.alternatives.filter(
		(alternative) => alternative.trim().length > 0,
	);
	const alternatives = allAlternatives.slice(0, MAX_CHOICE_OPTIONS);
	if (allAlternatives.length > alternatives.length) {
		omitted.push(
			`${allAlternatives.length - alternatives.length} alternative(s) beyond the limit of ${MAX_CHOICE_OPTIONS} did not reach the evaluation`,
		);
	}

	const source = input.contextText ?? "";
	const primarySets = alternatives.map((alternative) =>
		derivePrimaryAnchors(alternative),
	);
	const headerSets = alternatives.map((alternative) =>
		deriveOptionAnchors(alternative),
	);
	// The mention anchors of every option: a part of a combination belongs
	// to the option that names it and to no other.
	const mentionSets = primarySets.map((primaries) =>
		deriveMentionAnchors(
			primaries,
			primarySets
				.flat()
				.filter((token) => !primaries.includes(token)),
		),
	);
	const structuredByLabel = new Map<string, StructuredOption>();
	for (const option of structuredOptions) {
		if (typeof option?.label !== "string") continue;
		structuredByLabel.set(normalizeLabel(option.label), option);
	}

	const options: ChoiceOptionFacts[] = [];
	const claimed = new Set<number>();
	let derivedFromStructured = 0;
	let derivedFromMessage = 0;
	let missingMeaning = false;

	const readFacts = (
		values: unknown,
		fallback: string[],
	): { facts: string[]; cut: boolean } => {
		const list = Array.isArray(values)
			? values.filter(
					(value): value is string =>
						typeof value === "string" && value.trim().length > 0,
				)
			: fallback;
		const facts = list.slice(0, MAX_OPTION_FACTS).map((fact) => {
			const trimmed = fact.trim();
			return trimmed.length > MAX_OPTION_FACT_CHARS
				? trimmed.slice(0, MAX_OPTION_FACT_CHARS)
				: trimmed;
		});
		return { facts, cut: list.length > MAX_OPTION_FACTS };
	};

	for (const [index, alternative] of alternatives.entries()) {
		const id = `option_${index + 1}`;
		const label = alternative.trim();
		const headerCandidates = headerSets[index] ?? [];
		const mentionAnchors = mentionSets[index] ?? [];
		const otherHeaderCandidates = headerSets
			.flat()
			.filter((candidate) => !headerCandidates.includes(candidate));
		const otherMentionAnchors = mentionSets
			.flat()
			.filter((anchor) => !mentionAnchors.includes(anchor));

		// A labelled fact belongs to its label. The positional fallback is
		// only for a supplied option that carries no label at all.
		const labelled = structuredByLabel.get(normalizeLabel(label));
		const unlabelled =
			structuredOptions.length === alternatives.length
				? structuredOptions[index]
				: undefined;
		const supplied =
			labelled ??
			(unlabelled && typeof unlabelled.label !== "string"
				? unlabelled
				: undefined);

		const suppliedDescription =
			supplied && typeof supplied.description === "string"
				? supplied.description.trim()
				: "";
		if (supplied && supplied.description !== undefined && !suppliedDescription) {
			uncertainties.push(
				`${id} (${label}): the supplied description is empty or malformed, the message was used instead`,
			);
		}

		const extracted =
			suppliedDescription.length > 0
				? null
				: extractOptionFacts({
						source,
						headerCandidates,
						mentionAnchors,
						otherHeaderCandidates,
						otherMentionAnchors,
						claimed,
						question: input.question,
					});
		if (extracted && extracted.headerIndex >= 0) {
			claimed.add(extracted.headerIndex);
		}

		let description =
			suppliedDescription.length > 0
				? suppliedDescription
				: (extracted?.description ?? "");
		if (description.length > MAX_OPTION_DESCRIPTION_CHARS) {
			description = description.slice(0, MAX_OPTION_DESCRIPTION_CHARS);
			omitted.push(
				`${id} (${label}): the description was cut at ${MAX_OPTION_DESCRIPTION_CHARS} characters`,
			);
		}

		const tradeoffsResult = readFacts(
			supplied?.tradeoffs,
			extracted?.tradeoffs ?? [],
		);
		const constraintsResult = readFacts(
			supplied?.constraints,
			extracted?.constraints ?? [],
		);
		if (tradeoffsResult.cut || constraintsResult.cut) {
			omitted.push(
				`${id} (${label}): facts beyond the limit of ${MAX_OPTION_FACTS} did not reach the evaluation`,
			);
		}
		if (
			tradeoffsResult.facts.some(
				(fact) => fact.length === MAX_OPTION_FACT_CHARS,
			) ||
			constraintsResult.facts.some(
				(fact) => fact.length === MAX_OPTION_FACT_CHARS,
			)
		) {
			omitted.push(
				`${id} (${label}): a fact was cut at ${MAX_OPTION_FACT_CHARS} characters`,
			);
		}

		if (suppliedDescription.length > 0) {
			derivedFromStructured += 1;
		} else if (extracted?.found) {
			derivedFromMessage += 1;
		} else {
			missingMeaning = true;
			uncertainties.push(
				`${id} (${label}): the source does not state what this option means`,
			);
		}

		options.push({
			id:
				supplied?.id && typeof supplied.id === "string" && supplied.id.trim().length > 0
					? supplied.id
					: id,
			label,
			description,
			tradeoffs: tradeoffsResult.facts,
			constraints: constraintsResult.facts,
		});
	}

	// The problem.
	let problem =
		typeof structured.problem === "string" ? structured.problem.trim() : "";
	if (problem.length === 0) {
		problem = extractProblem(source, input.question);
	}
	if (problem.length > MAX_PROBLEM_CHARS) {
		problem = problem.slice(0, MAX_PROBLEM_CHARS);
		omitted.push(`the problem was cut at ${MAX_PROBLEM_CHARS} characters`);
	}
	if (problem.length === 0) {
		uncertainties.push(
			"the source does not state the problem the choice is about",
		);
	}

	// The authorization. Only supplied facts establish an authorization:
	// the message of the agent is not a human answer.
	const approved = Array.isArray(structured.authorization?.approved)
		? structured.authorization.approved.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
	const notEstablished = Array.isArray(structured.authorization?.notEstablished)
		? structured.authorization.notEstablished.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
	if (!structured.authorization) {
		notEstablished.push(
			"no human selection between the alternatives is recorded in this evaluation input",
		);
		if (/\bapproved\b/i.test(source)) {
			notEstablished.push(
				"the source reports an approval of an earlier action; it does not establish a selection between the alternatives",
			);
		}
	}

	// The uncertainties the agent reported itself.
	if (Array.isArray(structured.uncertainties)) {
		for (const uncertainty of structured.uncertainties) {
			if (typeof uncertainty === "string" && uncertainty.trim().length > 0) {
				uncertainties.push(uncertainty.trim());
			}
		}
	}

	// The earlier turns of the conversation. Their absence stays visible.
	if (input.history && input.history.available === true) {
		if (input.history.note) {
			omitted.push(input.history.note);
		}
	} else {
		const note =
			input.history?.note ??
			"the earlier turns of the conversation were not supplied";
		uncertainties.push(note);
		omitted.push(note);
	}

	const derived =
		derivedFromStructured > 0 && derivedFromMessage > 0
			? "mixed"
			: derivedFromStructured > 0
				? "structured"
				: "extracted";

	return {
		problem,
		question,
		options,
		authorization: { approved, notEstablished },
		uncertainties,
		source: {
			originalChars: source.length,
			truncated: omitted.length > 0,
			omittedInformation: omitted,
			derived,
			complete: !missingMeaning,
		},
	};
}

/**
 * The criterion text of one option: the label, the meaning and the
 * constraints that restrict it.
 *
 * The label alone does not tell the evaluation what the option does, so the
 * meaning travels with it. The constraint is part of the criterion because
 * an option whose restriction is invisible is an option the evaluation
 * cannot judge correctly.
 */
export function describeChoiceOption(
	id: string,
	label: string,
	description: string,
	constraints: string[],
): string {
	const meaning =
		description.length > 0
			? description
			: "the source does not state what this option means";
	const parts = [`${id} (${label}): ${meaning}`];
	if (constraints.length > 0) {
		parts.push(`constraints: ${constraints.join(" ")}`);
	}
	return parts.join(" - ").slice(0, MAX_OPTION_CRITERION_CHARS);
}

/**
 * The bounded text of a choice that reaches the evaluation.
 *
 * The excerpt carries the facts, not the beginning of the message: the
 * relevant sentence of a long message stands behind the two thousandth
 * character far more often than the first one does.
 */
export function renderChoiceExcerpt(context: ChoiceDecisionContext): string {
	const lines: string[] = [];
	lines.push(`Question: ${context.question}`);
	for (const option of context.options) {
		lines.push(
			`${option.id} (${option.label}): ${
				option.description || "the source does not state what this option means"
			}`,
		);
		// The constraints come first: a restriction is the fact that decides
		// the option, and it must not be pushed out by the consequences.
		for (const constraint of option.constraints) {
			lines.push(`  - constraint: ${constraint}`);
		}
		for (const tradeoff of option.tradeoffs) {
			lines.push(`  - consequence: ${tradeoff}`);
		}
	}
	if (context.problem.length > 0) {
		lines.push(`Problem: ${context.problem}`);
	}
	if (context.authorization.approved.length > 0) {
		lines.push(
			`Authorized: ${context.authorization.approved.join("; ")}`,
		);
	}
	for (const entry of context.authorization.notEstablished) {
		lines.push(`Not authorized: ${entry}`);
	}
	for (const uncertainty of context.uncertainties) {
		lines.push(`Uncertain: ${uncertainty}`);
	}
	if (context.source.omittedInformation.length > 0) {
		lines.push(
			`Not in the evaluation input: ${context.source.omittedInformation.join("; ")}`,
		);
	}
	return lines.join("\n").slice(0, MAX_CHOICE_EXCERPT_CHARS);
}
