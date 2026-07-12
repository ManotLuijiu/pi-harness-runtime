/**
 * Prompt Compiler - Types
 *
 * Type definitions for prompt compilation pipeline.
 */

import type { CompiledRequirement } from "@pi/requirement-compiler/src/types.js";
import type { CompiledTask } from "@pi/task-compiler/src/types.js";

// ─── Provider target ──────────────────────────────────────────────────────

/**
 * Supported provider targets.
 */
export type ProviderTarget =
	| "codex"
	| "minimax"
	| "glm"
	| "openai"
	| "anthropic"
	| "gemini";

// ─── Provider prompt profile ───────────────────────────────────────────────

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

// ─── Prompt sections ──────────────────────────────────────────────────────

/**
 * A single section of the compiled prompt.
 */
export interface PromptSection {
	id: string;
	kind:
		| "identity"
		| "project_rules"
		| "objective"
		| "acceptance_criteria"
		| "relevant_context"
		| "known_constraints"
		| "files_in_scope"
		| "required_output"
		| "tool_permissions"
		| "continuation_instructions"
		| "supplemental";
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

// ─── Continuation ─────────────────────────────────────────────────────────

/**
 * Context for resuming a prompt that hit output limits.
 */
export interface ContinuationContext {
	previousResponsePath: string;
	completedItems: string[];
	incompleteItems: string[];
	instruction: "continue_without_repeating";
}

// ─── Compiled context ────────────────────────────────────────────────────

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

function _contextEntryPriority(): void {
	// Compactable priorities (higher = less important):
	// 0 = critical (never compact)
	// 1-3 = important
	// 4-6 = useful
	// 7+ = supplemental
}

// ─── Redaction ────────────────────────────────────────────────────────────

/**
 * Redaction rule patterns.
 */
export interface RedactionRule {
	pattern: RegExp;
	replacement: string;
	description: string;
}

// ─── Prompt package ──────────────────────────────────────────────────────

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

// ─── Compile request ──────────────────────────────────────────────────────

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

// ─── Error codes ─────────────────────────────────────────────────────────

export type PromptCompileErrorCode =
	| "INVALID_TASK"
	| "MISSING_OBJECTIVE"
	| "MISSING_OUTPUT_CONTRACT"
	| "UNRESOLVED_REQUIRED_SOURCE"
	| "TOKEN_BUDGET_EXCEEDED"
	| "POLICY_CONFLICT";

/**
 * Prompt compilation error.
 */
export class PromptCompileError extends Error {
	readonly code: PromptCompileErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(
		code: PromptCompileErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
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
export const PROVIDER_PROFILES: Record<ProviderTarget, ProviderPromptProfile> =
	{
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
export const SECTION_ORDER: PromptSection["kind"][] = [
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
