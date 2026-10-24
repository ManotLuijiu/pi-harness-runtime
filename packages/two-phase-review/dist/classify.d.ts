/**
 * Todo classification for the two-phase workflow.
 *
 * Implementation work and queued review work must never be confused. The
 * workflow therefore classifies every todo item before it decides whether
 * the implementation phase is over.
 */
import type { TodoKind } from "./types.js";
/** Prefix of a todo item that is implementation work. */
export declare const IMPLEMENT_PREFIX = "[IMPLEMENT]";
/** Prefix of a todo item that is the queued review. */
export declare const REVIEW_PREFIX = "[REVIEW]";
/** Prefix of a todo item that fixes a confirmed review finding. */
export declare const REVIEW_FIX_PREFIX = "[REVIEW-FIX]";
/** The part of a todo item the workflow needs. */
export interface TodoLike {
    id?: number;
    subject?: string;
    status?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Classify a todo item.
 *
 * The metadata wins over the title: an explicit kind is more reliable than a
 * prefix. A `[REVIEW-FIX]` title is a fix item, not a review item, so the fix
 * prefix is checked first.
 */
export declare function classifyTodo(todo: TodoLike | null | undefined): TodoKind;
/** Is the todo item still open? */
export declare function isOpenTodo(todo: TodoLike): boolean;
/** Every open todo item. */
export declare function openTodos(todos: TodoLike[]): TodoLike[];
/**
 * The open todo items that are still implementation work.
 *
 * A queued review item is not implementation work: it must never block the
 * implementation. An unclassified item counts as implementation work, because
 * a task that is tracked without a prefix is still work that has to finish.
 */
export declare function implementationTodos(todos: TodoLike[]): TodoLike[];
/** The open todo items that represent the queued review. */
export declare function reviewTodos(todos: TodoLike[]): TodoLike[];
/** The open todo items that fix a confirmed review finding. */
export declare function reviewFixTodos(todos: TodoLike[]): TodoLike[];
/** Does the task still have implementation work? */
export declare function hasOpenImplementationWork(todos: TodoLike[]): boolean;
/** How many todo items of each kind are open. */
export declare function summarizeTodos(todos: TodoLike[]): {
    implementation: number;
    review: number;
    reviewFix: number;
};
/** Prefix a title with the kind of its todo item. */
export declare function buildTodoSubject(kind: TodoKind, text: string): string;
//# sourceMappingURL=classify.d.ts.map