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

import type {
	JevChoiceQuestion,
	JevQuestion,
	JevScoreQuestion,
} from "./types.js";
import { JevProviderError } from "./provider-error.js";

/** The API accepts at most 10 rubric levels for a score question. */
export const MAX_SCORE_LEVELS = 10;

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

function invalid(message: string): JevProviderError {
	return new JevProviderError(`TypeSafe request invalid: ${message}`, {
		provider: "typesafe",
		retryable: false,
	});
}

/**
 * Build the `criteria` dictionary of a choice question.
 *
 * A dictionary is used as-is. A list of names is converted to a dictionary
 * whose description is the name itself, which is how the API reads a question
 * that only names its candidates (the API rejects a LIST with 422).
 */
export function buildChoiceCriteria(
	questionId: string,
	question: JevChoiceQuestion
): TypeSafeChoiceCriteria {
	const explicit = question.criteria;

	if (explicit && !Array.isArray(explicit)) {
		const entries = Object.entries(explicit);
		if (entries.length === 0) {
			throw invalid(`question "${questionId}" has an empty choice criteria dictionary`);
		}
		const criteria: TypeSafeChoiceCriteria = {};
		for (const [name, description] of entries) {
			// An empty description is replaced by the name: the API reads the
			// description as the meaning of the candidate, and the name is the
			// only thing we know for sure.
			criteria[name] =
				typeof description === "string" && description.trim() !== ""
					? description
					: name;
		}
		return criteria;
	}

	const names = Array.isArray(explicit) ? explicit : (question.options ?? []);
	if (names.length === 0) {
		throw invalid(
			`question "${questionId}" needs "options" or "criteria" for a choice question`
		);
	}

	const descriptions = question.optionDescriptions ?? {};
	const criteria: TypeSafeChoiceCriteria = {};
	for (const name of names) {
		const description = descriptions[name];
		criteria[name] =
			typeof description === "string" && description.trim() !== "" ? description : name;
	}
	return criteria;
}

/**
 * Build the rubric of a score question and the scale its answer is reported on.
 *
 * An explicit rubric is used as-is. Otherwise one is derived from min/max,
 * limited to the 10 levels the API accepts.
 */
export function buildScoreScale(
	questionId: string,
	question: JevScoreQuestion
): { criteria: string[]; scale: ScoreScale } {
	const min = question.min ?? 0;
	const max = question.max ?? 100;
	const explicit = question.criteria;

	if (explicit && explicit.length > 0) {
		if (explicit.length > MAX_SCORE_LEVELS) {
			throw invalid(
				`question "${questionId}" has ${explicit.length} rubric levels, the TypeSafe API accepts at most ${MAX_SCORE_LEVELS}`
			);
		}
		return {
			criteria: explicit.map((level) => String(level)),
			scale: { levels: explicit.length, min, max },
		};
	}

	const span = Math.max(1, Math.round(max - min) + 1);
	const levels = Math.min(span, MAX_SCORE_LEVELS);
	const criteria: string[] = [];
	for (let i = 0; i < levels; i++) {
		const value =
			levels > 1 ? min + (i * (max - min)) / (levels - 1) : min;
		// The API wants level DESCRIPTIONS. A derived level has no meaning of
		// its own, so it is described by the value it stands for.
		criteria.push(`score ${Math.round(value * 100) / 100}`);
	}
	return { criteria, scale: { levels, min, max } };
}

/**
 * Convert a rubric position into the value on the reported scale.
 */
export function scorePositionToValue(position: number, scale: ScoreScale): number {
	if (scale.levels <= 1) return scale.min;
	const clamped = Math.min(Math.max(position, 0), scale.levels - 1);
	return scale.min + (clamped * (scale.max - scale.min)) / (scale.levels - 1);
}

/**
 * Convert a rubric position into a probability.
 */
export function scorePositionToProbability(position: number, scale: ScoreScale): number {
	if (scale.levels <= 1) return 0.5;
	const clamped = Math.min(Math.max(position, 0), scale.levels - 1);
	return clamped / (scale.levels - 1);
}

/**
 * Validate that a question can be expressed for the TypeSafe API.
 *
 * Returns the score scale of the question when it is a score question.
 */
export function validateQuestion(
	questionId: string,
	question: JevQuestion
): ScoreScale | null {
	if (!question || typeof question !== "object") {
		throw invalid(`question "${questionId}" is not an object`);
	}
	if (typeof question.instructions !== "string" || question.instructions.trim() === "") {
		throw invalid(`question "${questionId}" has no instructions`);
	}
	if (question.type === "noul") return null;
	if (question.type === "choice") {
		buildChoiceCriteria(questionId, question as JevChoiceQuestion);
		return null;
	}
	if (question.type === "score") {
		return buildScoreScale(questionId, question as JevScoreQuestion).scale;
	}
	throw invalid(
		`question "${questionId}" has unsupported type "${(question as { type: string }).type}"`
	);
}
