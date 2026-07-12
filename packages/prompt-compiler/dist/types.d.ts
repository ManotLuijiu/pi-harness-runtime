/**
 * Prompt Compiler - Types
 *
 * Type definitions for prompt compilation pipeline.
 */
import type { CompiledRequirement } from "@pi-harness/requirement-compiler";
import type { CompiledTask } from "@pi-harness/task-compiler";
/**
 * Supported provider targets.
 */
export type ProviderTarget = "codex" | "minimax" | "glm" | "openai" | "anthropic" | "gemini";
/**
 * Provider-specific formatting preferences.
 */
export interface ProviderPromptProfile {
    id: ProviderTarget;
    supportsSystemPrompt: boolean;
    preferredInstructionStyle: "xml" | "markdown" | "plain";
    maximumInputTokens: number;
    reservedOutputTokens: number;
    continuationMarker: string;
}
/**
 * A single section of the compiled prompt.
 */
export interface PromptSection {
    id: string;
    kind: "identity" | "project_rules" | "objective" | "acceptance_criteria" | "relevant_context" | "known_constraints" | "files_in_scope" | "required_output" | "tool_permissions" | "continuation_instructions" | "supplemental";
    content: string;
    required: boolean;
    compactable: boolean;
    sourceRefs: SourceRef[];
}
/**
 * Lightweight source reference.
 */
export interface SourceRef {
    source: string;
    line?: number;
    text: string;
}
/**
 * Context for resuming a prompt that hit output limits.
 */
export interface ContinuationContext {
    previousResponsePath: string;
    completedItems: string[];
    incompleteItems: string[];
    instruction: "continue_without_repeating";
}
/**
 * Compiled context from the Context Compiler (RFC-0042).
 * Contains deduplicated, prioritized context entries.
 */
export interface CompiledContext {
    entries: ContextEntry[];
}
export interface ContextEntry {
    id: string;
    content: string;
    priority: number;
    source: string;
    tags?: string[];
}
/**
 * Redaction rule patterns.
 */
export interface RedactionRule {
    pattern: RegExp;
    replacement: string;
    description: string;
}
/**
 * The output artifact of prompt compilation.
 */
export interface PromptPackage {
    version: "1";
    taskId: string;
    provider: ProviderTarget;
    system: string;
    user: string;
    sections: PromptSection[];
    estimatedInputTokens: number;
    sourceRefs: SourceRef[];
    hash: string;
    createdAt: string;
}
/**
 * Input to the prompt compiler.
 */
export interface PromptCompileRequest {
    task: CompiledTask;
    requirement: CompiledRequirement;
    context: CompiledContext;
    provider: ProviderTarget;
    attempt: number;
    continuation?: ContinuationContext;
}
export type PromptCompileErrorCode = "INVALID_TASK" | "MISSING_OBJECTIVE" | "MISSING_OUTPUT_CONTRACT" | "UNRESOLVED_REQUIRED_SOURCE" | "TOKEN_BUDGET_EXCEEDED" | "POLICY_CONFLICT";
/**
 * Prompt compilation error.
 */
export declare class PromptCompileError extends Error {
    readonly code: PromptCompileErrorCode;
    readonly details?: Record<string, unknown>;
    constructor(code: PromptCompileErrorCode, message: string, details?: Record<string, unknown>);
}
/**
 * Built-in provider profiles.
 */
export declare const PROVIDER_PROFILES: Record<ProviderTarget, ProviderPromptProfile>;
/**
 * Deterministic section ordering per RFC-0041.
 */
export declare const SECTION_ORDER: PromptSection["kind"][];
/**
 * Entries with priority >= this are eligible for compaction.
 * Priority 0 = critical (never compact).
 */
export declare const COMPACTABLE_THRESHOLD = 1;
//# sourceMappingURL=types.d.ts.map