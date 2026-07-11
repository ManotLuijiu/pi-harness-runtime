/**
 * Requirement Compiler - Public Exports
 *
 * Compiles raw requirements into validated CompiledRequirement.
 */

export { detectAmbiguities } from "./ambiguity-detector.js";
export { classifyStatements } from "./classifier.js";
export { compileRequirement } from "./compiler.js";
export { extractStatements } from "./extractor.js";
export { normalizeAcceptanceCriteria } from "./normalizer.js";
export { detectRisks } from "./risk-detector.js";
export {
	type AcceptanceCriterion,
	type AcceptanceNormalizer,
	type AmbiguityDetector,
	type CompiledRequirement,
	DEFAULT_COMPILER_CONFIG,
	// Types
	type RawRequirement,
	type RequirementActor,
	type RequirementAmbiguity,
	type RequirementAssumption,
	RequirementCompileError,
	type RequirementCompileErrorCode,
	RequirementCompileErrorCodes,
	type RequirementCompilerConfig,
	type RequirementCompilerDependencies,
	type RequirementConstraint,
	type RequirementGoal,
	type RequirementWorkflow,
	type RiskDetector,
	SDK_VERSION,
	type StatementClassifier,
	type StatementExtractor,
} from "./types.js";
