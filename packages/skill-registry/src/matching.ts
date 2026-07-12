/**
 * Skill Matching Functions (RFC-0052)
 */

import type { Skill, SkillTrigger } from "./types.js";

/**
 * Match a skill trigger against input
 */
export function matchTrigger(skill: Skill, input: string): number {
	const { trigger } = skill;
	const value = trigger.value;

	switch (trigger.type) {
		case "keyword": {
			const keywords = typeof value === "string" ? value.split(" ") : value;
			const inputLower = input.toLowerCase();
			const matchedCount = keywords.filter((k) => {
				const kw = k.toLowerCase();
				// Match if input contains keyword OR keyword contains input
				return inputLower.includes(kw) || kw.includes(inputLower);
			}).length;
			return matchedCount / keywords.length; // normalize to 0-1
		}

		case "pattern": {
			try {
				let regex: RegExp;
				if (typeof value === "string") {
					regex = new RegExp(value);
				} else {
					regex = new RegExp(value.join("|"));
				}
				return regex.test(input) ? 1 : 0;
			} catch {
				return 0;
			}
		}

		case "intent": {
			const intents = typeof value === "string" ? [value] : value;
			const matched = intents.some((i) =>
				input.toLowerCase().includes(i.toLowerCase()),
			);
			return matched ? 1 : 0;
		}

		case "tool_request": {
			return input.toLowerCase().includes("tool") ? 1 : 0;
		}

		default:
			return 0;
	}
}

/**
 * Find best matching skill
 */
export function findBestMatch(
	skills: Skill[],
	input: string,
	minConfidence = 0.5,
): Skill | undefined {
	const matches = skills
		.map((skill) => ({
			skill,
			score: matchTrigger(skill, input),
		}))
		.filter((m) => m.score >= (m.skill.trigger.confidence ?? minConfidence))
		.sort((a, b) => b.score - a.score);

	return matches[0]?.skill;
}

/**
 * Find all matching skills above threshold
 */
export function findAllMatches(
	skills: Skill[],
	input: string,
	minConfidence = 0.5,
): Array<{ skill: Skill; score: number }> {
	return skills
		.map((skill) => ({
			skill,
			score: matchTrigger(skill, input),
		}))
		.filter((m) => m.score >= (m.skill.trigger.confidence ?? minConfidence))
		.sort((a, b) => b.score - a.score);
}

/**
 * Create a skill trigger from common patterns
 */
export function createKeywordTrigger(keywords: string[]): SkillTrigger {
	return {
		type: "keyword",
		value: keywords,
		confidence: 0.3, // Lower threshold for partial matches
	};
}

export function createIntentTrigger(intents: string[]): SkillTrigger {
	return {
		type: "intent",
		value: intents,
		confidence: 0.3,
	};
}

export function createPatternTrigger(pattern: string): SkillTrigger {
	return {
		type: "pattern",
		value: pattern,
		confidence: 0.7,
	};
}
