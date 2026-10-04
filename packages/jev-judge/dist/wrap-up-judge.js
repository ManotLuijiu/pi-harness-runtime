/**
 * Wrap-Up Judge - Block until ALL todos complete
 *
 * Simple rule: ALL tasks must be done before summary.
 * Agent cannot pass incomplete tasks to user.
 */
/**
 * Check if all todos are complete
 */
export function checkWrapUp(todos) {
    const completed = todos.filter((t) => t.status === "completed");
    const incomplete = todos.filter((t) => t.status !== "completed");
    if (incomplete.length === 0) {
        return {
            ready: true,
            completedCount: completed.length,
            totalCount: todos.length,
            incompleteTasks: [],
            message: `[wrap-up] All ${todos.length} tasks completed. Ready for summary.`,
        };
    }
    const taskList = incomplete
        .map((t) => `  - [${t.id}] ${t.status}: ${t.subject}`)
        .join("\n");
    return {
        ready: false,
        completedCount: completed.length,
        totalCount: todos.length,
        incompleteTasks: incomplete,
        message: `[wrap-up] BLOCKED! ${incomplete.length}/${todos.length} tasks incomplete:\n${taskList}\n\nComplete all tasks before wrap-up.`,
    };
}
/**
 * Get status summary
 */
export function getTodoSummary(todos) {
    const completed = todos.filter((t) => t.status === "completed").length;
    const total = todos.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    if (completed === total) {
        return `[todos] ${completed}/${total} (${pct}%) - ALL COMPLETE`;
    }
    return `[todos] ${completed}/${total} (${pct}%) - ${total - completed} remaining`;
}
//# sourceMappingURL=wrap-up-judge.js.map