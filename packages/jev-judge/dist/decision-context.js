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
/**
 * Normalize a label for a comparison: case and spacing do not change what a
 * label means, but a different label is a different option.
 */
function normalizeLabel(label) {
    return label.trim().toLowerCase().replace(/\s+/g, " ");
}
/**
 * The primary tokens of a label: the short uppercase ones.
 *
 * "implement A" has the primary "A", "A+B" has the primary "A+B".
 */
export function derivePrimaryAnchors(label) {
    const tokens = label
        .split(/\s+/)
        .map((token) => token.replace(/^[^\w+]+/, "").replace(/[^\w+]+$/, ""))
        .filter((token) => token.length > 0);
    if (tokens.length === 0)
        return [];
    const upper = tokens.filter((token) => /^[A-Z0-9+]{1,6}$/.test(token) &&
        /[A-Z0-9]/.test(token) &&
        token !== token.toLowerCase());
    if (upper.length === 0) {
        return [tokens[tokens.length - 1]];
    }
    return upper;
}
/**
 * The primary anchor of an option: the token that names it.
 */
export function deriveOptionAnchor(label) {
    return derivePrimaryAnchors(label)[0] ?? "";
}
/**
 * The tokens that can name an option in the source message.
 *
 * A combination like "A+B" also names its parts, because the message writes
 * the second part as its own header ("**B. ...**").
 */
export function deriveOptionAnchors(label) {
    const anchors = [];
    for (const token of derivePrimaryAnchors(label)) {
        if (!anchors.includes(token))
            anchors.push(token);
        for (const part of token.split("+")) {
            if (part.length > 0 && !anchors.includes(part))
                anchors.push(part);
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
function deriveMentionAnchors(primaries, otherPrimaries) {
    const anchors = [];
    for (const token of primaries) {
        if (!isIdentifierToken(token))
            continue;
        if (!anchors.includes(token))
            anchors.push(token);
        for (const part of token.split("+")) {
            if (part.length === 0)
                continue;
            if (!isIdentifierToken(part))
                continue;
            if (otherPrimaries.includes(part))
                continue;
            if (!anchors.includes(part))
                anchors.push(part);
        }
    }
    return anchors;
}
/**
 * Whether a token names something: it carries a capital letter or a digit.
 */
function isIdentifierToken(token) {
    return /[A-Z0-9]/.test(token) && token !== token.toLowerCase();
}
/**
 * Split the source message into paragraphs.
 *
 * A paragraph is a block of text separated by an empty line. The position of
 * every paragraph is kept, so a fact can be pointed at.
 */
function splitParagraphs(source) {
    const paragraphs = [];
    const pattern = /\S[\s\S]*?(?=\n\s*\n|$)/g;
    let match;
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
function isWordCharacter(character) {
    return /[A-Za-z0-9]/.test(character);
}
/**
 * Whether a line is the header of an option: the line starts with the
 * anchor, followed by a separator.
 *
 * The anchor comes from the text of the agent, so the check is a string
 * comparison and never a pattern built from that text.
 */
function isOptionHeader(line, anchor) {
    if (anchor.length === 0)
        return false;
    const stripped = line.replace(/^\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*/, "");
    if (!stripped.startsWith(anchor))
        return false;
    const next = stripped.charAt(anchor.length);
    if (next === "")
        return true;
    if (isWordCharacter(next))
        return false;
    return HEADER_SEPARATORS.includes(next);
}
/** Whether a line mentions the anchor as a word. */
function mentionsAnchor(line, anchor) {
    if (anchor.length === 0)
        return false;
    let from = 0;
    for (;;) {
        const index = line.indexOf(anchor, from);
        if (index === -1)
            return false;
        const before = index > 0 ? line.charAt(index - 1) : "";
        const after = line.charAt(index + anchor.length);
        if ((before === "" || !isWordCharacter(before)) &&
            (after === "" || !isWordCharacter(after))) {
            return true;
        }
        from = index + 1;
    }
}
/** Strip the markdown markers of a heading or a bold label. */
function stripMarkdown(value) {
    return value
        .replace(/^\s*(?:[-*+]\s+)+/, "")
        .replace(/(\*\*|__|`)/g, "")
        .trim();
}
/**
 * Remove the anchor of an option from the beginning of its description, so
 * the description starts with the meaning and not with the label.
 */
function stripLeadingAnchor(text, anchor) {
    const stripped = text.replace(/^\s*(?:\*\*|__)?\s*/, "");
    if (anchor.length === 0 || !stripped.startsWith(anchor))
        return stripped;
    const next = stripped.charAt(anchor.length);
    if (next !== "" && isWordCharacter(next))
        return stripped;
    return stripped.slice(anchor.length).replace(/^[.:)\-–—\s]+/, "").trim();
}
/**
 * A paragraph states a restriction when it names a duty, a prohibition or a
 * condition. The markers are conservative: a paragraph that is not
 * recognized is a consequence, not a restriction.
 */
function statesConstraint(paragraph) {
    return (/^\s*(caveat|caveats?|careful|note|warning|constraint|constraints?|however|but|instead|only if|never|must|do not|don't|cannot|can't)\b/i.test(paragraph) ||
        /\b(must|never|cannot|can not|only if|is required to|has to|not just)\b/i.test(paragraph));
}
/**
 * Whether a text mentions an anchor as a word.
 */
function mentionsAny(text, anchors) {
    return anchors.some((anchor) => mentionsAnchor(text, anchor));
}
/**
 * The offset of a line in the source message.
 */
function lineOffset(lines, index) {
    let offset = 0;
    for (let position = 0; position < index; position += 1) {
        offset += lines[position].length + 1;
    }
    return offset;
}
/**
 * Whether a paragraph is a fact of one option.
 *
 * The paragraph has to name the option near its beginning, and it must not
 * name another option there: a paragraph about two options says something
 * about both, and it belongs to neither of them alone.
 */
function belongsToOption(text, ownAnchors, otherAnchors) {
    const window = text.slice(0, MENTION_WINDOW_CHARS);
    if (!mentionsAny(window, ownAnchors))
        return false;
    return !mentionsAny(window, otherAnchors);
}
/**
 * The line of the header of an option.
 *
 * The candidates are tried in order, and a header that another option
 * already claims is skipped: the label "A+B" must not land on the header of
 * the option "A".
 */
function locateHeader(lines, candidates, claimed) {
    for (const candidate of candidates) {
        for (let index = 0; index < lines.length; index += 1) {
            if (claimed.has(index))
                continue;
            if (isOptionHeader(lines[index], candidate))
                return index;
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
export function extractOptionFacts(input) {
    const { source, headerCandidates, mentionAnchors, otherHeaderCandidates, otherMentionAnchors, claimed, question, } = input;
    const empty = {
        description: "",
        tradeoffs: [],
        constraints: [],
        found: false,
        headerIndex: -1,
        descriptionConstraint: false,
    };
    if (headerCandidates.length === 0 || source.length === 0)
        return empty;
    const lines = source.split("\n");
    const headerIndex = locateHeader(lines, headerCandidates, claimed);
    const paragraphs = splitParagraphs(source);
    let description = "";
    let region = [];
    // The range of the section of the option in the source message.
    let sectionRange = null;
    // The paragraphs of the source that the section of the option covers.
    const covered = new Set();
    if (headerIndex >= 0) {
        // The region of the option ends at the next option header, at the
        // next heading of the message, or at the question itself.
        const regionLines = [];
        const questionMarker = question.trim().slice(0, 40);
        let lastIndex = headerIndex;
        for (let index = headerIndex; index < lines.length; index += 1) {
            const line = lines[index];
            if (index > headerIndex) {
                if (/^\s*#{1,6}\s/.test(line))
                    break;
                if (questionMarker.length > 0 && line.includes(questionMarker))
                    break;
                if (otherHeaderCandidates.some((other) => isOptionHeader(line, other))) {
                    break;
                }
            }
            regionLines.push(line);
            lastIndex = index;
        }
        sectionRange = {
            start: lineOffset(lines, headerIndex),
            end: lineOffset(lines, lastIndex) +
                lines[lastIndex].length,
        };
        region = splitParagraphs(regionLines.join("\n"));
        if (region.length > 0) {
            const anchor = headerCandidates.find((candidate) => isOptionHeader(lines[headerIndex], candidate)) ?? headerCandidates[0];
            description = stripMarkdown(stripLeadingAnchor(region[0].text, anchor));
        }
    }
    else {
        // No header: the first paragraph that names the option and no other
        // one carries its meaning.
        const candidateIndex = paragraphs.findIndex((paragraph) => belongsToOption(paragraph.text, mentionAnchors, otherMentionAnchors));
        const candidate = candidateIndex >= 0
            ? paragraphs[candidateIndex]
            : undefined;
        if (candidate) {
            const anchor = mentionAnchors.find((token) => mentionsAnchor(candidate.text.slice(0, MENTION_WINDOW_CHARS), token)) ?? mentionAnchors[0];
            description = stripMarkdown(stripLeadingAnchor(candidate.text, anchor));
            covered.add(candidateIndex);
        }
    }
    // The paragraphs that the section of the option covers: they belong to
    // the option, and they are not looked at a second time.
    if (sectionRange) {
        paragraphs.forEach((paragraph, paragraphIndex) => {
            const paragraphEnd = paragraph.start + paragraph.text.length;
            if (paragraph.start < sectionRange.end &&
                paragraphEnd > sectionRange.start) {
                covered.add(paragraphIndex);
            }
        });
    }
    const tradeoffs = [];
    const constraints = [];
    /** Remember a fact, as a constraint when it states a restriction. */
    const recordFact = (value) => {
        if (statesConstraint(value)) {
            if (!constraints.includes(value))
                constraints.push(value);
        }
        else if (!tradeoffs.includes(value)) {
            tradeoffs.push(value);
        }
    };
    /**
     * A fact of the section of the option belongs to it by position: the
     * section writes about that option, and a paragraph that names it with
     * a pronoun ("it must actually connect") is still about it. A paragraph
     * that names another option belongs to that one.
     */
    const addSectionFact = (text) => {
        const value = stripMarkdown(text);
        if (value.length === 0)
            return;
        if (mentionsAny(value.slice(0, MENTION_WINDOW_CHARS), otherMentionAnchors)) {
            return;
        }
        recordFact(value);
    };
    /**
     * A fact from outside the section has to name the option, and it must
     * not name another one: "Caveat for B: ..." is about B.
     */
    const addNamedFact = (text) => {
        const value = stripMarkdown(text);
        if (value.length === 0)
            return;
        if (!belongsToOption(value, mentionAnchors, otherMentionAnchors))
            return;
        recordFact(value);
    };
    // The paragraphs of the section after the description.
    for (const paragraph of region.slice(1)) {
        addSectionFact(paragraph.text);
    }
    // A caveat that names the option belongs to the option, even when it
    // stands outside the section: "Caveat for B: ..." is about B.
    for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
        if (covered.has(paragraphIndex))
            continue;
        addNamedFact(paragraph.text);
    }
    return {
        description,
        tradeoffs,
        constraints,
        found: description.length > 0,
        headerIndex,
        descriptionConstraint: statesConstraint(description),
    };
}
/**
 * The paragraph of the source message that stands directly before the
 * question: it states the problem the question is about.
 */
function extractProblem(source, question) {
    if (source.length === 0)
        return "";
    const questionIndex = question.length > 0 ? source.indexOf(question) : -1;
    if (questionIndex > 0) {
        const before = source.slice(0, questionIndex);
        const paragraphs = splitParagraphs(before);
        const last = paragraphs[paragraphs.length - 1];
        if (last)
            return stripMarkdown(last.text);
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
export function buildChoiceDecisionContext(input) {
    const omitted = [];
    const uncertainties = [];
    const structured = input.structured ?? {};
    const structuredOptions = Array.isArray(structured.options)
        ? structured.options
        : [];
    // The question itself.
    let question = input.question.trim();
    if (question.length > MAX_CHOICE_QUESTION_CHARS) {
        question = question.slice(0, MAX_CHOICE_QUESTION_CHARS);
        omitted.push(`the question was cut at ${MAX_CHOICE_QUESTION_CHARS} characters`);
    }
    // The alternatives, with their stable ids.
    const allAlternatives = input.alternatives.filter((alternative) => alternative.trim().length > 0);
    const alternatives = allAlternatives.slice(0, MAX_CHOICE_OPTIONS);
    if (allAlternatives.length > alternatives.length) {
        omitted.push(`${allAlternatives.length - alternatives.length} alternative(s) beyond the limit of ${MAX_CHOICE_OPTIONS} did not reach the evaluation`);
    }
    const source = input.contextText ?? "";
    const primarySets = alternatives.map((alternative) => derivePrimaryAnchors(alternative));
    const headerSets = alternatives.map((alternative, index) => {
        // A token that is the primary label of another option belongs to
        // that option and to no other: the header of "A+B" is not the header
        // of the option "A", whatever the order of the alternatives is.
        const otherPrimaries = primarySets
            .flat()
            .filter((token) => !primarySets[index]?.includes(token));
        return deriveOptionAnchors(alternative).filter((token) => !otherPrimaries.includes(token));
    });
    // The mention anchors of every option: a part of a combination belongs
    // to the option that names it and to no other.
    const mentionSets = primarySets.map((primaries) => deriveMentionAnchors(primaries, primarySets
        .flat()
        .filter((token) => !primaries.includes(token))));
    const structuredByLabel = new Map();
    for (const option of structuredOptions) {
        if (typeof option?.label !== "string")
            continue;
        structuredByLabel.set(normalizeLabel(option.label), option);
    }
    const options = [];
    const claimed = new Set();
    let derivedFromStructured = 0;
    let derivedFromMessage = 0;
    let derivedFromBoth = 0;
    let missingMeaning = false;
    const readFacts = (values, fallback) => {
        const list = Array.isArray(values)
            ? values.filter((value) => typeof value === "string" && value.trim().length > 0)
            : fallback;
        const facts = list.slice(0, MAX_OPTION_FACTS).map((fact) => {
            const trimmed = fact.trim();
            return trimmed.length > MAX_OPTION_FACT_CHARS
                ? trimmed.slice(0, MAX_OPTION_FACT_CHARS)
                : trimmed;
        });
        return { facts, cut: list.length > MAX_OPTION_FACTS };
    };
    /**
     * The facts of an option: the supplied ones come first, the facts of the
     * source follow. A fact that is in both lists is kept once.
     *
     * The result is undefined when the supplied facts are not a list: the
     * facts of the source are then the only ones, and the caller reports
     * the malformed facts itself.
     */
    const mergeFacts = (supplied, sourceFacts) => {
        if (!Array.isArray(supplied))
            return undefined;
        const merged = [];
        for (const value of supplied) {
            if (typeof value !== "string")
                continue;
            const trimmed = value.trim();
            if (trimmed.length === 0)
                continue;
            if (!merged.includes(trimmed))
                merged.push(trimmed);
        }
        for (const fact of sourceFacts) {
            if (!merged.includes(fact))
                merged.push(fact);
        }
        return merged;
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
        const unlabelled = structuredOptions.length === alternatives.length
            ? structuredOptions[index]
            : undefined;
        const supplied = labelled ??
            (unlabelled && typeof unlabelled.label !== "string"
                ? unlabelled
                : undefined);
        const suppliedDescription = supplied && typeof supplied.description === "string"
            ? supplied.description.trim()
            : "";
        if (supplied && supplied.description !== undefined && !suppliedDescription) {
            uncertainties.push(`${id} (${label}): the supplied description is empty or malformed, the message was used instead`);
        }
        // The extraction always runs. A supplied description is the meaning
        // of the option, not a replacement for the facts of the message: a
        // caveat that only the message carries has to survive it.
        const extracted = extractOptionFacts({
            source,
            headerCandidates,
            mentionAnchors,
            otherHeaderCandidates,
            otherMentionAnchors,
            claimed,
            question: input.question,
        });
        if (extracted.headerIndex >= 0) {
            claimed.add(extracted.headerIndex);
        }
        let description = suppliedDescription.length > 0
            ? suppliedDescription
            : extracted.description;
        if (description.length > MAX_OPTION_DESCRIPTION_CHARS) {
            description = description.slice(0, MAX_OPTION_DESCRIPTION_CHARS);
            omitted.push(`${id} (${label}): the description was cut at ${MAX_OPTION_DESCRIPTION_CHARS} characters`);
        }
        // The wording of the source for the option survives a supplied
        // description: it can carry the caveat of the option ("it must
        // actually connect").
        const sourceWording = suppliedDescription.length > 0 &&
            extracted.description.length > 0 &&
            extracted.description !== suppliedDescription
            ? extracted.description
            : "";
        const sourceConstraints = [
            ...(sourceWording.length > 0 && extracted.descriptionConstraint
                ? [sourceWording]
                : []),
            ...extracted.constraints,
        ];
        const sourceTradeoffs = [
            ...(sourceWording.length > 0 && !extracted.descriptionConstraint
                ? [sourceWording]
                : []),
            ...extracted.tradeoffs,
        ];
        const sourceFacts = sourceConstraints.length > 0 || sourceTradeoffs.length > 0;
        const tradeoffsResult = readFacts(mergeFacts(supplied?.tradeoffs, sourceTradeoffs), sourceTradeoffs);
        const constraintsResult = readFacts(mergeFacts(supplied?.constraints, sourceConstraints), sourceConstraints);
        if (tradeoffsResult.cut || constraintsResult.cut) {
            omitted.push(`${id} (${label}): facts beyond the limit of ${MAX_OPTION_FACTS} did not reach the evaluation`);
        }
        if (tradeoffsResult.facts.some((fact) => fact.length === MAX_OPTION_FACT_CHARS) ||
            constraintsResult.facts.some((fact) => fact.length === MAX_OPTION_FACT_CHARS)) {
            omitted.push(`${id} (${label}): a fact was cut at ${MAX_OPTION_FACT_CHARS} characters`);
        }
        if (suppliedDescription.length > 0 && sourceFacts) {
            // The meaning comes from the structure, the facts of the message
            // are merged with it: the provenance is mixed.
            derivedFromBoth += 1;
        }
        else if (suppliedDescription.length > 0) {
            derivedFromStructured += 1;
        }
        else if (extracted.found) {
            derivedFromMessage += 1;
        }
        else {
            missingMeaning = true;
            uncertainties.push(`${id} (${label}): the source does not state what this option means`);
        }
        options.push({
            id: supplied?.id && typeof supplied.id === "string" && supplied.id.trim().length > 0
                ? supplied.id
                : id,
            label,
            description,
            tradeoffs: tradeoffsResult.facts,
            constraints: constraintsResult.facts,
        });
    }
    // The problem.
    let problem = typeof structured.problem === "string" ? structured.problem.trim() : "";
    if (problem.length === 0) {
        problem = extractProblem(source, input.question);
    }
    if (problem.length > MAX_PROBLEM_CHARS) {
        problem = problem.slice(0, MAX_PROBLEM_CHARS);
        omitted.push(`the problem was cut at ${MAX_PROBLEM_CHARS} characters`);
    }
    if (problem.length === 0) {
        uncertainties.push("the source does not state the problem the choice is about");
    }
    // The authorization. Only supplied facts establish an authorization:
    // the message of the agent is not a human answer.
    const approved = Array.isArray(structured.authorization?.approved)
        ? structured.authorization.approved.filter((value) => typeof value === "string")
        : [];
    const notEstablished = Array.isArray(structured.authorization?.notEstablished)
        ? structured.authorization.notEstablished.filter((value) => typeof value === "string")
        : [];
    if (!structured.authorization) {
        notEstablished.push("no human selection between the alternatives is recorded in this evaluation input");
        if (/\bapproved\b/i.test(source)) {
            notEstablished.push("the source reports an approval of an earlier action; it does not establish a selection between the alternatives");
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
    }
    else {
        const note = input.history?.note ??
            "the earlier turns of the conversation were not supplied";
        uncertainties.push(note);
        omitted.push(note);
    }
    const derived = derivedFromBoth > 0 ||
        (derivedFromStructured > 0 && derivedFromMessage > 0)
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
export function describeChoiceOption(id, label, description, constraints) {
    const meaning = description.length > 0
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
export function renderChoiceExcerpt(context) {
    const lines = [];
    lines.push(`Question: ${context.question}`);
    for (const option of context.options) {
        lines.push(`${option.id} (${option.label}): ${option.description || "the source does not state what this option means"}`);
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
        lines.push(`Authorized: ${context.authorization.approved.join("; ")}`);
    }
    for (const entry of context.authorization.notEstablished) {
        lines.push(`Not authorized: ${entry}`);
    }
    for (const uncertainty of context.uncertainties) {
        lines.push(`Uncertain: ${uncertainty}`);
    }
    if (context.source.omittedInformation.length > 0) {
        lines.push(`Not in the evaluation input: ${context.source.omittedInformation.join("; ")}`);
    }
    return lines.join("\n").slice(0, MAX_CHOICE_EXCERPT_CHARS);
}
//# sourceMappingURL=decision-context.js.map