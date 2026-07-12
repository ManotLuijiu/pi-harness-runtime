/**
 * Prompt Compiler - Request Normalization
 *
 * Normalizes a PromptCompileRequest to ensure deterministic, stable output.
 * Stable array ordering is critical for reproducible prompt hashes.
 */
/**
 * Normalize a PromptCompileRequest for deterministic processing.
 *
 * - Arrays are sorted lexicographically by ID
 * - Strings are trimmed
 * - Empty values are removed
 * - Duplicates are eliminated (stable unique)
 */
export function normalizeRequest(request) {
    const { task, requirement, context, provider, attempt, continuation } = request;
    return {
        taskId: task.id.trim(),
        requirementId: requirement.id.trim(),
        provider: provider.trim(),
        attempt,
        objective: task.objective.trim(),
        acceptanceCriteria: stableUnique(requirement.acceptanceCriteria
            .map((ac) => ac.outcome.join("; "))
            .filter(Boolean)),
        contextEntries: normalizeContextEntries(context.entries),
        constraints: stableUnique(requirement.constraints
            .map((c) => c.description)
            .filter(Boolean)),
        filesInScope: stableUnique(task.filesInScope.map((f) => f.path)),
        expectedOutputs: stableUnique(task.expectedOutputs
            .map((o) => {
            if (o.kind === "file")
                return `file:${o.path}`;
            if (o.kind === "test_result")
                return `test:${o.description}`;
            return `${o.kind}:${o.description}`;
        })
            .filter(Boolean)),
        toolPermissions: stableUnique(task.permittedCommands.filter(Boolean)),
        continuation: continuation
            ? normalizeContinuation(continuation)
            : undefined,
    };
}
function normalizeContextEntries(entries) {
    return [...entries]
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
        .map((e) => ({
        id: e.id.trim(),
        content: e.content.trim(),
        priority: e.priority,
        source: e.source.trim(),
    }));
}
function normalizeContinuation(cont) {
    return {
        previousResponsePath: cont.previousResponsePath.trim(),
        completedItems: [...cont.completedItems].sort(),
        incompleteItems: [...cont.incompleteItems].sort(),
    };
}
/**
 * Stable unique: preserves first occurrence order.
 */
function stableUnique(items) {
    const seen = new Set();
    return items.filter((item) => {
        if (seen.has(item))
            return false;
        seen.add(item);
        return true;
    });
}
//# sourceMappingURL=normalize.js.map