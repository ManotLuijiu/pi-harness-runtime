/**
 * Prompt Compiler - Request Normalization
 *
 * Normalizes a PromptCompileRequest to ensure deterministic, stable output.
 * Stable array ordering is critical for reproducible prompt hashes.
 */

import type { CompiledRequirement } from "@pi-harness/requirement-compiler";
import type { CompiledTask } from "@pi-harness/task-compiler";
import type { ContinuationContext, PromptCompileRequest } from "./types.js";

/**
 * Normalized compile request with stable ordering.
 */
export interface NormalizedRequest {
	taskId: string;
	requirementId: string;
	provider: string;
	attempt: number;
	objective: string;
	acceptanceCriteria: string[];
	contextEntries: NormalizedContextEntry[];
	constraints: string[];
	filesInScope: string[];
	expectedOutputs: string[];
	toolPermissions: string[];
	continuation: NormalizedContinuation | undefined;
}

/**
 * Normalized context entry with stable string representation.
 */
export interface NormalizedContextEntry {
	id: string;
	content: string;
	priority: number;
	source: string;
}

/**
 * Normalized continuation context.
 */
export interface NormalizedContinuation {
	previousResponsePath: string;
	completedItems: string[];
	incompleteItems: string[];
}

/**
 * Normalize a PromptCompileRequest for deterministic processing.
 *
 * - Arrays are sorted lexicographically by ID
 * - Strings are trimmed
 * - Empty values are removed
 * - Duplicates are eliminated (stable unique)
 */
export function normalizeRequest(
	request: PromptCompileRequest,
): NormalizedRequest {
	const { task, requirement, context, provider, attempt, continuation } =
		request;

	return {
		taskId: task.id.trim(),
		requirementId: requirement.id.trim(),
		provider: provider.trim(),
		attempt,
		objective: task.objective.trim(),
		acceptanceCriteria: stableUnique(
			requirement.acceptanceCriteria
				.map((ac: CompiledRequirement["acceptanceCriteria"][number]) =>
					ac.outcome.join("; "),
				)
				.filter(Boolean),
		),
		contextEntries: normalizeContextEntries(context.entries),
		constraints: stableUnique(
			requirement.constraints
				.map((c: CompiledRequirement["constraints"][number]) => c.description)
				.filter(Boolean),
		),
		filesInScope: stableUnique(
			task.filesInScope
				.map((f: CompiledTask["filesInScope"][number]) =>
					typeof f === "string"
						? f.trim()
						: ((f as unknown as { path?: string }).path ?? "").trim(),
				)
				.filter(Boolean),
		),
		expectedOutputs: stableUnique(
			task.expectedOutputs
				.map((o: CompiledTask["expectedOutputs"][number]) => {
					if (o.kind === "file") return `file:${o.path}`;
					if (o.kind === "test_result") return `test:${o.description}`;
					return `${o.kind}:${o.description}`;
				})
				.filter(Boolean),
		),
		toolPermissions: stableUnique(task.permittedCommands.filter(Boolean)),
		continuation: continuation
			? normalizeContinuation(continuation)
			: undefined,
	};
}

function normalizeContextEntries(
	entries: NormalizedRequest["contextEntries"],
): NormalizedContextEntry[] {
	return [...entries]
		.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
		.map((e) => ({
			id: e.id.trim(),
			content: e.content.trim(),
			priority: e.priority,
			source: e.source.trim(),
		}));
}

function normalizeContinuation(
	cont: ContinuationContext,
): NormalizedContinuation {
	return {
		previousResponsePath: cont.previousResponsePath.trim(),
		completedItems: [...cont.completedItems].sort(),
		incompleteItems: [...cont.incompleteItems].sort(),
	};
}

/**
 * Stable unique: preserves first occurrence order.
 */
function stableUnique(items: string[]): string[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item)) return false;
		seen.add(item);
		return true;
	});
}
