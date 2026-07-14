/**
 * Learning Engine (RFC-0058)
 *
 * Re-exports all public types and classes.
 */
export { LearningEngine, createLearningEngine } from "./engine.js";
export type { LearningRequest, LearningResult, LearnedExperience, ExtractedPattern, PatternType, ProviderExecutionMetric, RepairAttempt, HumanFeedback, ExperienceScope, ExperienceStatus, ConfidenceFactors, } from "./types.js";
export { containsSecret, redactSecrets, calculateConfidence, SECRET_PATTERNS, } from "./types.js";
//# sourceMappingURL=index.d.ts.map