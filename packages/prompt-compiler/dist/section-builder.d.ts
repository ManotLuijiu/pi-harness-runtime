/**
 * Prompt Compiler - Section Builder
 *
 * Assembles prompt sections from a normalized request.
 * Each section is built independently for testability.
 */
import type { NormalizedRequest } from "./normalize.js";
import type { PromptSection } from "./types.js";
/**
 * Build all prompt sections from a normalized request.
 * Section order is deterministic per RFC-0041.
 */
export declare function buildSections(normalized: NormalizedRequest, projectRules: string[]): PromptSection[];
//# sourceMappingURL=section-builder.d.ts.map