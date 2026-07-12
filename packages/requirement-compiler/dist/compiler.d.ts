/**
 * Requirement Compiler - Main Compiler
 *
 * Compiles raw requirements into validated CompiledRequirement.
 */
import { type CompiledRequirement, type RawRequirement, type RequirementCompilerDependencies } from "./types.js";
/**
 * Compile a raw requirement into a validated CompiledRequirement.
 */
export declare function compileRequirement(raw: RawRequirement, deps?: RequirementCompilerDependencies): Promise<CompiledRequirement>;
//# sourceMappingURL=compiler.d.ts.map