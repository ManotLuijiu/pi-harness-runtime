/**
 * Context Compiler - Cache & Invalidation
 *
 * Generates deterministic cache keys from selected source hashes.
 * Tracks invalidation triggers.
 */
/**
 * Generate a deterministic cache key from compiled context items.
 * Includes source file hashes for content invalidation.
 */
export function generateCacheKey(taskId, items, taskObjective) {
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
export function shouldInvalidate(previous, invalidation, currentItemHashes) {
    switch (invalidation.reason) {
        case "source_hash_changed": {
            const changed = invalidation.details?.sourcePath;
            if (!changed)
                return true;
            const item = previous.items.find((i) => i.source === changed);
            if (!item)
                return false;
            const currentHash = currentItemHashes.get(changed);
            return currentHash !== item.contentHash;
        }
        case "project_rule_changed": {
            const rulePath = invalidation.details?.rulePath;
            const ruleItem = previous.items.find((i) => i.kind === "project_rule" &&
                (i.source === rulePath || i.filePath === rulePath));
            return ruleItem !== undefined;
        }
        case "required_okf_changed": {
            const okfId = invalidation.details?.okfId;
            return (previous.items.find((i) => i.kind === "okf_concept" && i.id === okfId && i.required) !== undefined);
        }
        case "task_objective_changed": {
            return true; // Always invalidate on objective change
        }
        case "test_failure_superseded": {
            const oldFailure = invalidation.details?.oldFailureId;
            if (!oldFailure)
                return false;
            const existingFailure = previous.items.find((i) => i.kind === "test_failure" && i.id === oldFailure);
            return existingFailure !== undefined;
        }
        case "worktree_branch_changed": {
            const oldBranch = invalidation.details?.oldBranch;
            const newBranch = invalidation.details?.newBranch;
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
export function extractItemHashes(items) {
    const map = new Map();
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
export function simpleHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
}
//# sourceMappingURL=cache.js.map