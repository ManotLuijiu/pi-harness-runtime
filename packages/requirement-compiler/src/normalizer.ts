/**
 * Requirement Compiler - Acceptance Criteria Normalizer
 *
 * Converts acceptance criterion statements into Given/When/Then format.
 */

import type { AcceptanceCriterion, ExtractedStatement } from "./types.js";

/**
 * Parse Given/When/Then from a statement if already in that format.
 */
function parseGivenWhenThen(text: string): {
	given?: string;
	when?: string;
	outcome?: string[];
} | null {
	const givenMatch = text.match(/given\s+([\s\S]+?)(?:,?\s+when|,?\s+then|$)/i);
	const whenMatch = text.match(/when\s+([\s\S]+?)(?:,?\s+then|$)/i);
	const thenMatch = text.match(/then\s+([\s\S]+)/i);

	if (!givenMatch && !whenMatch && !thenMatch) return null;

	return {
		given: givenMatch ? givenMatch[1].trim() : undefined,
		when: whenMatch ? whenMatch[1].trim() : undefined,
		outcome: thenMatch
			? thenMatch[1]
					.split(/,?\s+and\s+/i)
					.map((s) => s.trim())
					.filter(Boolean)
			: undefined,
	};
}

/**
 * Infer Given/When/Then from natural language.
 */
function inferGivenWhenThen(text: string): {
	given: string;
	when: string;
	outcome: string[];
} {
	const lower = text.toLowerCase();

	// Extract action verb phrase
	const actionMatch = lower.match(/(?:should|must|will|can)\s+(.+)/);
	const action = actionMatch ? actionMatch[1].trim() : text;

	// Infer "when" from context
	let when = "the user submits the form";
	if (lower.includes("on click")) {
		when = "the user clicks the button";
	} else if (lower.includes("on load")) {
		when = "the page loads";
	} else if (lower.includes("on save")) {
		when = "the user saves";
	} else if (lower.includes("on submit")) {
		when = "the user submits";
	} else if (lower.includes("on delete")) {
		when = "the user deletes";
	}

	// Infer "given" preconditions
	let given = "a valid user is authenticated";
	if (lower.includes("admin")) {
		given = "an admin user is authenticated";
	} else if (lower.includes("guest")) {
		given = "a guest user is on the page";
	}

	return {
		given,
		when,
		outcome: [`${action.charAt(0).toUpperCase()}${action.slice(1)}.`],
	};
}

/**
 * Check if a statement is automatable.
 */
function isAutomatable(text: string): boolean {
	const lower = text.toLowerCase();
	// Statements mentioning UI interactions, API calls, file operations are automatable
	const automatablePatterns = [
		"return",
		"save",
		"display",
		"show",
		"create",
		"delete",
		"update",
		"send",
		"receive",
		"validate",
		"check",
		"verify",
		"contain",
		"visible",
		"exists",
		"http",
		"response",
		"status",
	];
	// Statements about visual design, "feel", "look" are not easily automatable
	const nonAutomatablePatterns = [
		"look good",
		"feel",
		"user experience",
		"intuitive",
		"pleasing",
		"beautiful",
	];

	const hasAuto = automatablePatterns.some((p) => lower.includes(p));
	const hasNonAuto = nonAutomatablePatterns.some((p) => lower.includes(p));

	return hasAuto && !hasNonAuto;
}

/**
 * Normalize acceptance criteria statements.
 */
export function normalizeAcceptanceCriteria(
	statements: ExtractedStatement[],
): AcceptanceCriterion[] {
	const criteria: AcceptanceCriterion[] = [];
	let criterionIndex = 0;

	for (const stmt of statements) {
		const text = stmt.originalText;
		const parsed = parseGivenWhenThen(text);

		if (parsed) {
			criteria.push({
				id: `AC-${String(criterionIndex + 1).padStart(3, "0")}`,
				given: parsed.given ?? "prerequisites are met",
				when: parsed.when ?? "the action is performed",
				outcome: parsed.outcome ?? [text],
				sourceRefs: [stmt.sourceRef],
				automatable: isAutomatable(text),
				originalText: text,
			});
		} else {
			// Infer Given/When/Then from natural language
			const inferred = inferGivenWhenThen(text);
			criteria.push({
				id: `AC-${String(criterionIndex + 1).padStart(3, "0")}`,
				given: inferred.given,
				when: inferred.when,
				outcome: inferred.outcome,
				sourceRefs: [stmt.sourceRef],
				automatable: isAutomatable(text),
				originalText: text,
			});
		}

		criterionIndex++;
	}

	return criteria;
}
