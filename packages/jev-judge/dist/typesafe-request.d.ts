/**
 * Request building for the TypeSafe System One API.
 *
 * The API contract (https://docs.typesafe.ai/api.md, verified against the live
 * endpoint) is stricter than a plain prompt-and-parse call:
 *
 * - `noul`   : { type, instructions } - optional criteria {"true","false"}
 * - `choice` : { type, instructions, criteria } where criteria is a
 *              DICTIONARY of `name -> description`. A list of names is
 *              rejected with 422 "Input should be a valid dictionary".
 * - `score`  : { type, instructions, criteria } where criteria is a REQUIRED
 *              ordered list of level descriptions (1..10 entries). The answer
 *              is the probability-weighted POSITION in that list, not an
 *              arbitrary number.
 *
 * A single invalid question fails the whole request, so the mapping is
 * validated locally before anything is sent.
 */
import type { JevChoiceQuestion, JevQuestion, JevScoreQuestion } from "./types.js";
/** The API accepts at most 10 rubric levels for a score question. */
export declare const MAX_SCORE_LEVELS = 10;
/** The criteria shape the API expects for a choice question. */
export type TypeSafeChoiceCriteria = Record<string, string>;
/** A score scale: the rubric levels plus the scale the answer is reported on. */
export interface ScoreScale {
    /** Number of rubric levels. */
    levels: number;
    /** Lower bound of the reported scale. */
    min: number;
    /** Upper bound of the reported scale. */
    max: number;
}
/**
 * Build the `criteria` dictionary of a choice question.
 *
 * A dictionary is used as-is. A list of names is converted to a dictionary
 * whose description is the name itself, which is how the API reads a question
 * that only names its candidates (the API rejects a LIST with 422).
 */
export declare function buildChoiceCriteria(questionId: string, question: JevChoiceQuestion): TypeSafeChoiceCriteria;
/**
 * Build the rubric of a score question and the scale its answer is reported on.
 *
 * An explicit rubric is used as-is. Otherwise one is derived from min/max,
 * limited to the 10 levels the API accepts.
 */
export declare function buildScoreScale(questionId: string, question: JevScoreQuestion): {
    criteria: string[];
    scale: ScoreScale;
};
/**
 * Convert a rubric position into the value on the reported scale.
 */
export declare function scorePositionToValue(position: number, scale: ScoreScale): number;
/**
 * Convert a rubric position into a probability.
 */
export declare function scorePositionToProbability(position: number, scale: ScoreScale): number;
/**
 * Validate that a question can be expressed for the TypeSafe API.
 *
 * Returns the score scale of the question when it is a score question.
 */
export declare function validateQuestion(questionId: string, question: JevQuestion): ScoreScale | null;
//# sourceMappingURL=typesafe-request.d.ts.map