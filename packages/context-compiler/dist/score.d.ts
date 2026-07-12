/**
 * Context Compiler - Scoring
 *
 * Scores optional candidates for inclusion priority.
 * Required candidates bypass scoring.
 * Deterministic: same inputs produce same scores.
 */
import type { ContextCandidate, ScoringWeights } from "./types.js";
/**
 * Merge user weights with defaults.
 */
export declare function mergeWeights(user?: Partial<ScoringWeights>): ScoringWeights;
/**
 * Score a candidate.
 * Required candidates get MAX_SCORE (always included).
 * Optional candidates get a weighted score.
 *
 * Score = priority * priority_weight
 *       + direct_file_reference_bonus
 *       + recent_failure_relevance
 *       + dependency_relevance
 *       + framework_relevance
 *       - stale_penalty
 *       - duplication_penalty
 */
export declare function scoreCandidate(candidate: ContextCandidate, weights: ScoringWeights, context: ScoreContext): number;
/**
 * Score context for candidate evaluation.
 */
export interface ScoreContext {
    directFileReferences: Set<string>;
    taskDependencies: string[];
}
/**
 * Maximum score — always included regardless of budget.
 */
export declare const MAX_SCORE = 9999;
/**
 * Sort candidates by score (descending), then by source (ascending) for determinism.
 * Required candidates are always first.
 */
export declare function rankCandidates(candidates: ContextCandidate[], weights: ScoringWeights, context: ScoreContext): Array<{
    candidate: ContextCandidate;
    score: number;
}>;
//# sourceMappingURL=score.d.ts.map