/**
 * Prompt Compiler - Rendering
 *
 * Renders assembled sections into provider-specific prompt strings.
 * Provider-specific formatting is applied here only.
 * Core semantics must remain provider-independent.
 */
import type { PromptSection, ProviderPromptProfile } from "./types.js";
/**
 * Rendered prompt strings.
 */
export interface RenderedPrompt {
    system: string;
    user: string;
}
/**
 * Render sections into provider-specific prompt strings.
 *
 * System-prompt-supporting providers get rules in system, rest in user.
 * Objective and acceptance criteria always go in user.
 */
export declare function renderForProvider(sections: PromptSection[], profile: ProviderPromptProfile): RenderedPrompt;
//# sourceMappingURL=render.d.ts.map