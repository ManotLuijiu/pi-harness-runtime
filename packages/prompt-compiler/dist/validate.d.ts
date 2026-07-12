/**
 * Prompt Compiler - Validation
 *
 * Validates compiled sections against the request.
 * Fails fast on hard requirements.
 */
import type { NormalizedRequest } from "./normalize.js";
import type { PromptSection, ProviderPromptProfile } from "./types.js";
/**
 * Validation options.
 */
export interface ValidateOptions {
    provider: ProviderPromptProfile;
    maxRetries?: number;
}
/**
 * Validate compiled sections.
 *
 * Throws PromptCompileError for:
 * - Empty task ID
 * - Empty objective
 * - No expected outputs defined
 * - Token budget exceeded
 * - Required source unresolved
 */
export declare function validateSections(sections: PromptSection[], request: NormalizedRequest, _options: ValidateOptions): void;
/**
 * Validate that the token budget is not exceeded.
 */
export declare function validateTokenBudget(estimatedTokens: number, profile: ProviderPromptProfile): void;
//# sourceMappingURL=validate.d.ts.map