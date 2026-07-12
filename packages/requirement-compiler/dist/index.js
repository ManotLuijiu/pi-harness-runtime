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
export { DEFAULT_COMPILER_CONFIG, RequirementCompileError, RequirementCompileErrorCodes, SDK_VERSION, } from "./types.js";
//# sourceMappingURL=index.js.map