/**
 * Context Compiler - Scoring
 *
 * Scores optional candidates for inclusion priority.
 * Required candidates bypass scoring.
 * Deterministic: same inputs produce same scores.
 */

import type { ContextCandidate, ScoringWeights } from "./types.js";
import { DEFAULT_SCORING_WEIGHTS } from "./types.js";

/**
 * Merge user weights with defaults.
 */
export function mergeWeights(user?: Partial<ScoringWeights>): ScoringWeights {
	if (!user) return { ...DEFAULT_SCORING_WEIGHTS };
	return {
		priority: user.priority ?? DEFAULT_SCORING_WEIGHTS.priority,
		directFileReference:
			user.directFileReference ?? DEFAULT_SCORING_WEIGHTS.directFileReference,
		recentFailureRelevance:
			user.recentFailureRelevance ??
			DEFAULT_SCORING_WEIGHTS.recentFailureRelevance,
		dependencyRelevance:
			user.dependencyRelevance ?? DEFAULT_SCORING_WEIGHTS.dependencyRelevance,
		frameworkRelevance:
			user.frameworkRelevance ?? DEFAULT_SCORING_WEIGHTS.frameworkRelevance,
		stalePenalty: user.stalePenalty ?? DEFAULT_SCORING_WEIGHTS.stalePenalty,
		duplicationPenalty:
			user.duplicationPenalty ?? DEFAULT_SCORING_WEIGHTS.duplicationPenalty,
	};
}

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
export function scoreCandidate(
	candidate: ContextCandidate,
	weights: ScoringWeights,
	context: ScoreContext,
): number {
	// Required items bypass scoring
	if (candidate.required) return MAX_SCORE;

	let score = 0;

	// Base score from priority
	score += candidate.priority * weights.priority;

	// Direct file reference bonus
	if (context.directFileReferences.has(candidate.source)) {
		score += weights.directFileReference;
	}

	// Recent failure relevance
	if (candidate.kind === "test_failure" && candidate.updatedAt) {
		const age = Date.now() - new Date(candidate.updatedAt).getTime();
		if (age < 24 * 60 * 60 * 1000) {
			score += weights.recentFailureRelevance;
		}
	}

	// Dependency relevance: candidates related to task dependencies score higher
	if (context.taskDependencies.some((dep) => candidate.source.includes(dep))) {
		score += weights.dependencyRelevance;
	}

	// Framework relevance: OKF concepts and framework files score higher
	if (candidate.kind === "okf_concept" || candidate.kind === "project_rule") {
		score += weights.frameworkRelevance;
	}

	// Stale penalty: items not updated recently
	if (candidate.updatedAt) {
		const age = Date.now() - new Date(candidate.updatedAt).getTime();
		const staleDays = age / (24 * 60 * 60 * 1000);
		score -= Math.min(
			staleDays * weights.stalePenalty,
			weights.stalePenalty * 3,
		);
	}

	return score;
}

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
export const MAX_SCORE = 9999;

/**
 * Sort candidates by score (descending), then by source (ascending) for determinism.
 * Required candidates are always first.
 */
export function rankCandidates(
	candidates: ContextCandidate[],
	weights: ScoringWeights,
	context: ScoreContext,
): Array<{ candidate: ContextCandidate; score: number }> {
	return [...candidates]
		.map((c) => ({ candidate: c, score: scoreCandidate(c, weights, context) }))
		.sort((a, b) => {
			// Required candidates always first
			if (a.candidate.required !== b.candidate.required) {
				return a.candidate.required ? -1 : 1;
			}
			// Higher score first
			if (a.score !== b.score) return b.score - a.score;
			// Tiebreak: source alphabetically
			return a.candidate.source.localeCompare(b.candidate.source);
		});
}
