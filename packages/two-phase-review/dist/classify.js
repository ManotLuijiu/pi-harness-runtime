/**
 * Todo classification for the two-phase workflow.
 *
 * Implementation work and queued review work must never be confused. The
 * workflow therefore classifies every todo item before it decides whether
 * the implementation phase is over.
 */
/** Prefix of a todo item that is implementation work. */
export const IMPLEMENT_PREFIX = "[IMPLEMENT]";
/** Prefix of a todo item that is the queued review. */
export const REVIEW_PREFIX = "[REVIEW]";
/** Prefix of a todo item that fixes a confirmed review finding. */
export const REVIEW_FIX_PREFIX = "[REVIEW-FIX]";
/** Prefix of a todo item that is the validation of the task. */
export const TEST_PREFIX = "[TEST]";
const KIND_BY_NAME = {
    implement: "implement",
    implementation: "implement",
    impl: "implement",
    review: "review",
    review_pending: "review",
    "review-pending": "review",
    review_fix: "review_fix",
    "review-fix": "review_fix",
    reviewfix: "review_fix",
    test: "test",
    validation: "test",
    validation_test: "test",
    other: "other",
};
/**
 * Classify a todo item.
 *
 * The metadata wins over the title: an explicit kind is more reliable than a
 * prefix. A `[REVIEW-FIX]` title is a fix item, not a review item, so the fix
 * prefix is checked first.
 */
export function classifyTodo(todo) {
    if (!todo)
        return "other";
    const metadata = todo.metadata ?? {};
    const declared = metadata.kind ?? metadata.todoKind;
    if (typeof declared === "string") {
        const key = declared.toLowerCase().trim().replace(/[\s-]+/g, "_");
        const mapped = KIND_BY_NAME[key];
        if (mapped)
            return mapped;
    }
    const subject = (todo.subject ?? "").trim().toUpperCase();
    if (subject.startsWith(REVIEW_FIX_PREFIX))
        return "review_fix";
    if (subject.startsWith(TEST_PREFIX))
        return "test";
    if (subject.startsWith(IMPLEMENT_PREFIX))
        return "implement";
    if (subject.startsWith(REVIEW_PREFIX))
        return "review";
    return "other";
}
/** Is the todo item still open? */
export function isOpenTodo(todo) {
    return todo.status === "pending" || todo.status === "in_progress";
}
/** Every open todo item. */
export function openTodos(todos) {
    return todos.filter((todo) => isOpenTodo(todo));
}
/**
 * The open todo items that are still implementation work.
 *
 * A queued review item is not implementation work: it must never block the
 * implementation. A test item is not implementation work either: it is the
 * validation of the finished work, and it belongs to the phase that follows
 * the review. An unclassified item counts as implementation work, because
 * a task that is tracked without a prefix is still work that has to finish.
 */
export function implementationTodos(todos) {
    return openTodos(todos).filter((todo) => {
        const kind = classifyTodo(todo);
        return kind === "implement" || kind === "other";
    });
}
/**
 * The finished todo items that were implementation work.
 *
 * They are the evidence that the implementation of the task actually ran.
 * A session without any finished implementation work has no proof that the
 * implementation is over, so the workflow waits instead of starting the
 * review of a task that is still running.
 */
export function completedImplementationTodos(todos) {
    return todos.filter((todo) => {
        if (todo.status !== "completed")
            return false;
        const kind = classifyTodo(todo);
        return kind === "implement" || kind === "other";
    });
}
/** The open todo items that represent the queued review. */
export function reviewTodos(todos) {
    return openTodos(todos).filter((todo) => classifyTodo(todo) === "review");
}
/** The open todo items that fix a confirmed review finding. */
export function reviewFixTodos(todos) {
    return openTodos(todos).filter((todo) => classifyTodo(todo) === "review_fix");
}
/**
 * The open todo items that are the validation of the task.
 *
 * A test item carries the validation plan of the task: the tiers it declares
 * and the final tier that has to pass before the task is complete.
 */
export function testTodos(todos) {
    return openTodos(todos).filter((todo) => classifyTodo(todo) === "test");
}
/** Does the task still have implementation work? */
export function hasOpenImplementationWork(todos) {
    return implementationTodos(todos).length > 0;
}
/** How many todo items of each kind are open. */
export function summarizeTodos(todos) {
    const byKind = (kind) => todos.filter((todo) => classifyTodo(todo) === kind);
    return {
        implementation: implementationTodos(todos).length,
        review: reviewTodos(todos).length,
        reviewFix: reviewFixTodos(todos).length,
        test: testTodos(todos).length,
        implementationTotal: byKind("implement").length + byKind("other").length,
        reviewTotal: byKind("review").length,
        reviewFixTotal: byKind("review_fix").length,
        testTotal: byKind("test").length,
    };
}
const PREFIX_BY_KIND = {
    implement: IMPLEMENT_PREFIX,
    review: REVIEW_PREFIX,
    review_fix: REVIEW_FIX_PREFIX,
    test: TEST_PREFIX,
    other: "",
};
/** Prefix a title with the kind of its todo item. */
export function buildTodoSubject(kind, text) {
    const prefix = PREFIX_BY_KIND[kind];
    const clean = text.trim();
    if (!prefix)
        return clean;
    return clean.toUpperCase().startsWith(prefix) ? clean : `${prefix} ${clean}`;
}
//# sourceMappingURL=classify.js.map