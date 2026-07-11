/**
 * Prompt Compiler - Public API
 *
 * Deterministic prompt compilation for pi-harness-runtime.
 *
 * @example
 * import { compilePrompt, createHasher, createIdentityRedactor } from "@pi/prompt-compiler";
 *
 * const pkg = await compilePrompt(request, {
 *   hasher: createHasher(),
 *   redactor: createIdentityRedactor(),
 *   clock: { now: () => new Date() },
 *   projectRules: ["Use TypeScript", "No console.log in production"],
 * });
 */

export { compilePrompt } from "./compiler.js";
export {
	createHasher,
	createSyncHasher,
	createIdentityRedactor,
} from "./compiler.js";

export type { PromptCompilerDependencies } from "./compiler.js";

export { PromptCompileError } from "./types.js";
export type {
	ProviderTarget,
	ProviderPromptProfile,
	PromptSection,
	PromptPackage,
	PromptCompileRequest,
	PromptCompileErrorCode,
	ContinuationContext,
	CompiledContext,
	ContextEntry,
	PromptCompileErrorCode as ErrorCode,
} from "./types.js";

export { PROVIDER_PROFILES, SECTION_ORDER } from "./types.js";

export { normalizeRequest } from "./normalize.js";
export { buildSections } from "./section-builder.js";
export {
	deduplicateSections,
	normalizeForDeduplication,
} from "./deduplicate.js";
export { compactToBudget, estimateTokens } from "./budget.js";
export { validateSections, validateTokenBudget } from "./validate.js";
export { renderForProvider } from "./render.js";
