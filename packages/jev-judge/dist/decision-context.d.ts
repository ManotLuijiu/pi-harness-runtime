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
 * - A comparison is never dropped: a statement that names two options
 *   ("Unlike A, B must connect every server") is kept with the option it
 *   constrains, and a comparison whose subject is not established is
 *   reported as an uncertainty.
 * - Every bound is declared and every cut is reported, so a reader can tell
 *   what the evaluation did not see.
 */
/** How many options reach the evaluation. */
export declare const MAX_CHOICE_OPTIONS = 10;
/** How much of the problem statement reaches the evaluation. */
export declare const MAX_PROBLEM_CHARS = 600;
/** How much of the question reaches the evaluation. */
export declare const MAX_CHOICE_QUESTION_CHARS = 600;
/** How much of one option description reaches the evaluation. */
export declare const MAX_OPTION_DESCRIPTION_CHARS = 600;
/** How many tradeoffs or constraints per option reach the evaluation. */
export declare const MAX_OPTION_FACTS = 6;
/** How much of one fact (a tradeoff, a constraint) reaches the evaluation. */
export declare const MAX_OPTION_FACT_CHARS = 400;
/** How much of the rendered excerpt reaches the evaluation. */
export declare const MAX_CHOICE_EXCERPT_CHARS = 2000;
/** How much of one criterion reaches the evaluation. */
export declare const MAX_OPTION_CRITERION_CHARS = 400;
/**
 * How far into a paragraph a name of an option is looked for.
 *
 * A paragraph that names an option in its first line talks about that
 * option; a paragraph that names it much later talks about something else.
 */
export declare const MENTION_WINDOW_CHARS = 80;
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
        /** Where the facts came from: the structure, the message, or both. */
        derived: "structured" | "extracted" | "mixed";
        /** Whether every option carries its meaning. */
        complete: boolean;
    };
}
/** The facts the agent supplied itself. They come first; the facts of the
 * message are merged with them. */
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
    history?: {
        available: boolean;
        note?: string;
    };
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
    /**
     * Whether the description of the option states a restriction.
     *
     * The wording of the source for an option can carry the caveat of that
     * option ("it must actually connect"). When another wording is supplied
     * for the option, this tells the caller which list the source wording
     * belongs to.
     */
    descriptionConstraint: boolean;
    /**
     * The comparisons that could not be attributed to one option.
     *
     * A statement that compares the options without saying which one it
     * constrains is kept with every option it names, and it is reported here
     * so that the comparison does not disappear silently.
     */
    comparative: string[];
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
/**
 * The primary tokens of a label: the short uppercase ones.
 *
 * "implement A" has the primary "A", "A+B" has the primary "A+B".
 */
export declare function derivePrimaryAnchors(label: string): string[];
/**
 * The primary anchor of an option: the token that names it.
 */
export declare function deriveOptionAnchor(label: string): string;
/**
 * The tokens that can name an option in the source message.
 *
 * A combination like "A+B" also names its parts, because the message writes
 * the second part as its own header ("**B. ...**").
 */
export declare function deriveOptionAnchors(label: string): string[];
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
export declare function extractOptionFacts(input: OptionExtractionInput): ExtractedOption;
/**
 * Build the decision context of a choice question.
 *
 * The function never decides and never authorizes: it prepares the facts
 * that a decision is made of, and it names what it could not establish.
 */
export declare function buildChoiceDecisionContext(input: ChoiceContextInput): ChoiceDecisionContext;
/**
 * The criterion text of one option: the label, the meaning and the
 * constraints that restrict it.
 *
 * The label alone does not tell the evaluation what the option does, so the
 * meaning travels with it. The constraint is part of the criterion because
 * an option whose restriction is invisible is an option the evaluation
 * cannot judge correctly.
 */
export declare function describeChoiceOption(id: string, label: string, description: string, constraints: string[]): string;
/**
 * The bounded text of a choice that reaches the evaluation.
 *
 * The excerpt carries the facts, not the beginning of the message: the
 * relevant sentence of a long message stands behind the two thousandth
 * character far more often than the first one does.
 */
export declare function renderChoiceExcerpt(context: ChoiceDecisionContext): string;
//# sourceMappingURL=decision-context.d.ts.map