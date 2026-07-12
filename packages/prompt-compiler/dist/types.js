/**
 * Prompt Compiler - Types
 *
 * Type definitions for prompt compilation pipeline.
 */
function __contextEntryPriority() {
    // Compactable priorities (higher = less important):
    // 0 = critical (never compact)
    // 1-3 = important
    // 4-6 = useful
    // 7+ = supplemental
}
/**
 * Prompt compilation error.
 */
export class PromptCompileError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "PromptCompileError";
        this.code = code;
        this.details = details;
    }
}
// ─── Provider profiles ────────────────────────────────────────────────────
/**
 * Built-in provider profiles.
 */
export const PROVIDER_PROFILES = {
    codex: {
        id: "codex",
        supportsSystemPrompt: true,
        preferredInstructionStyle: "markdown",
        maximumInputTokens: 128_000,
        reservedOutputTokens: 4_096,
        continuationMarker: "<!-- CONTINUE -->",
    },
    minimax: {
        id: "minimax",
        supportsSystemPrompt: true,
        preferredInstructionStyle: "markdown",
        maximumInputTokens: 128_000,
        reservedOutputTokens: 4_096,
        continuationMarker: "<!-- CONTINUE -->",
    },
    glm: {
        id: "glm",
        supportsSystemPrompt: true,
        preferredInstructionStyle: "markdown",
        maximumInputTokens: 128_000,
        reservedOutputTokens: 4_096,
        continuationMarker: "<!-- CONTINUE -->",
    },
    openai: {
        id: "openai",
        supportsSystemPrompt: true,
        preferredInstructionStyle: "markdown",
        maximumInputTokens: 128_000,
        reservedOutputTokens: 4_096,
        continuationMarker: "<!-- CONTINUE -->",
    },
    anthropic: {
        id: "anthropic",
        supportsSystemPrompt: true,
        preferredInstructionStyle: "xml",
        maximumInputTokens: 200_000,
        reservedOutputTokens: 4_096,
        continuationMarker: "<!-- CONTINUE -->",
    },
    gemini: {
        id: "gemini",
        supportsSystemPrompt: true,
        preferredInstructionStyle: "markdown",
        maximumInputTokens: 1_000_000,
        reservedOutputTokens: 8_192,
        continuationMarker: "<!-- CONTINUE -->",
    },
};
// ─── Section order ────────────────────────────────────────────────────────
/**
 * Deterministic section ordering per RFC-0041.
 */
export const SECTION_ORDER = [
    "identity",
    "project_rules",
    "objective",
    "acceptance_criteria",
    "relevant_context",
    "known_constraints",
    "files_in_scope",
    "required_output",
    "tool_permissions",
    "continuation_instructions",
    "supplemental",
];
// ─── Compactable priority threshold ───────────────────────────────────────
/**
 * Entries with priority >= this are eligible for compaction.
 * Priority 0 = critical (never compact).
 */
export const COMPACTABLE_THRESHOLD = 1;
//# sourceMappingURL=types.js.map