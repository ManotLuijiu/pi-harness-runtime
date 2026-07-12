/**
 * Skill Matching Functions (RFC-0052)
 */
import type { Skill, SkillTrigger } from "./types.js";
/**
 * Match a skill trigger against input
 */
export declare function matchTrigger(skill: Skill, input: string): number;
/**
 * Find best matching skill
 */
export declare function findBestMatch(skills: Skill[], input: string, minConfidence?: number): Skill | undefined;
/**
 * Find all matching skills above threshold
 */
export declare function findAllMatches(skills: Skill[], input: string, minConfidence?: number): Array<{
    skill: Skill;
    score: number;
}>;
/**
 * Create a skill trigger from common patterns
 */
export declare function createKeywordTrigger(keywords: string[]): SkillTrigger;
export declare function createIntentTrigger(intents: string[]): SkillTrigger;
export declare function createPatternTrigger(pattern: string): SkillTrigger;
//# sourceMappingURL=matching.d.ts.map