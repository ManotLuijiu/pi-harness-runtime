/**
 * Autonomous Refactor — Executor
 *
 * Applies code modifications using AST-based transformations.
 */
import type { RefactorRule, RefactorResult, RuleMatch, ApplyOptions } from "./types.js";
/**
 * Apply a rule match to a file
 */
export declare function applyRule(rule: RefactorRule, match: RuleMatch, options: ApplyOptions): Promise<RefactorResult>;
/**
 * Apply all rules to a set of matches
 */
export declare function applyAllRules(rules: RefactorRule[], matches: RuleMatch[], options: ApplyOptions): Promise<RefactorResult[]>;
//# sourceMappingURL=executor.d.ts.map