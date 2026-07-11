/**
 * Context Compiler - Cache & Invalidation
 *
 * Generates deterministic cache keys from selected source hashes.
 * Tracks invalidation triggers.
 */

import type {
	CompiledContext,
	CompiledContextItem,
	ContextInvalidation,
} from "./types.js";

/**
 * Generate a deterministic cache key from compiled context items.
 * Includes source file hashes for content invalidation.
 */
export function generateCacheKey(
	taskId: string,
	items: CompiledContextItem[],
	taskObjective: string,
): string {
	// Sort by source path for determinism
	const hashes = items
		.filter((item) => item.contentHash)
		.map((item) => `${item.source}:${item.contentHash}`)
		.sort();

	const objectiveHash = simpleHash(taskObjective);
	const combined = `${taskId}:${objectiveHash}:${hashes.join(",")}`;

	return `ctx:${simpleHash(combined)}`;
}

/**
 * Check if a compiled context should be invalidated.
 *
 * Invalidation triggers:
 * - A selected source file hash changed
 * - A project rule changed
 * - A required OKF concept changed
 * - The task objective changed
 * - A test failure superseded an old one
 * - Worktree branch/HEAD changed
 */
export function shouldInvalidate(
	previous: CompiledContext,
	invalidation: ContextInvalidation,
	currentItemHashes: Map<string, string>,
): boolean {
	switch (invalidation.reason) {
		case "source_hash_changed": {
			const changed = invalidation.details?.sourcePath as string | undefined;
			if (!changed) return true;
			const item = previous.items.find((i) => i.source === changed);
			if (!item) return false;
			const currentHash = currentItemHashes.get(changed);
			return currentHash !== item.contentHash;
		}

		case "project_rule_changed": {
			const rulePath = invalidation.details?.rulePath as string | undefined;
			const ruleItem = previous.items.find(
				(i) =>
					i.kind === "project_rule" &&
					(i.source === rulePath || i.filePath === rulePath),
			);
			return ruleItem !== undefined;
		}

		case "required_okf_changed": {
			const okfId = invalidation.details?.okfId as string | undefined;
			return (
				previous.items.find(
					(i) => i.kind === "okf_concept" && i.id === okfId && i.required,
				) !== undefined
			);
		}

		case "task_objective_changed": {
			return true; // Always invalidate on objective change
		}

		case "test_failure_superseded": {
			const oldFailure = invalidation.details?.oldFailureId as
				| string
				| undefined;
			if (!oldFailure) return false;
			const existingFailure = previous.items.find(
				(i) => i.kind === "test_failure" && i.id === oldFailure,
			);
			return existingFailure !== undefined;
		}

		case "worktree_branch_changed": {
			const oldBranch = invalidation.details?.oldBranch as string | undefined;
			const newBranch = invalidation.details?.newBranch as string | undefined;
			// Invalidate if any source file changed or if branch changed
			return oldBranch !== newBranch;
		}

		default:
			return false;
	}
}

/**
 * Generate current item hashes from a compiled context.
 */
export function extractItemHashes(
	items: CompiledContextItem[],
): Map<string, string> {
	const map = new Map<string, string>();
	for (const item of items) {
		if (item.contentHash) {
			map.set(item.source, item.contentHash);
		}
	}
	return map;
}

/**
 * Simple deterministic hash for strings.
 * Used for cache keys when crypto is unavailable.
 */
export function simpleHash(text: string): string {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0;
	}
	return Math.abs(hash).toString(16).padStart(8, "0");
}
