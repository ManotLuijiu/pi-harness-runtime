/**
 * Requirement Compiler - Statement Classifier
 *
 * Classifies extracted statements into goals, constraints, preferences, etc.
 */
import type { ClassificationResult, ExtractedStatement, RequirementCompilerConfig } from "./types.js";
/**
 * Classify all extracted statements.
 */
export declare function classifyStatements(statements: ExtractedStatement[], config: RequirementCompilerConfig): ClassificationResult;
//# sourceMappingURL=classifier.d.ts.map