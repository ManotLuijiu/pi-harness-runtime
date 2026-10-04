/**
 * Skill Linter
 *
 * Hermes-style quality checks for skills.
 * Ensures skills capture "lessons, not logs".
 */
import type { Skill, LintResult, LintRule, LintSeverity } from "./types.js";
/**
 * Hermes-style linter rules
 */
export declare const LINTER_RULES: LintRule[];
/**
 * Lint a skill
 */
export declare function lintSkill(skill: Skill, rules?: LintRule[]): LintResult[];
/**
 * Lint a skill and return formatted output
 */
export declare function lintSkillFormatted(skill: Skill, rules?: LintRule[]): string;
/**
 * Get lint summary for multiple skills
 */
export declare function lintSkillsSummary(skills: Skill[]): {
    total: number;
    passed: number;
    failed: number;
    bySeverity: Record<LintSeverity, number>;
    byRule: Record<string, number>;
};
/**
 * Create custom lint rule
 */
export declare function createLintRule(name: string, description: string, severity: LintSeverity, check: (skill: Skill) => LintResult | null): LintRule;
/**
 * Filter lint results by severity
 */
export declare function filterLintResults(results: LintResult[], minSeverity: LintSeverity): LintResult[];
//# sourceMappingURL=linter.d.ts.map