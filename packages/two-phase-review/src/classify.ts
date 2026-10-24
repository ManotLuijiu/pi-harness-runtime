/**
 * Todo classification for the two-phase workflow.
 *
 * Implementation work and queued review work must never be confused. The
 * workflow therefore classifies every todo item before it decides whether
 * the implementation phase is over.
 */

import type { TodoKind } from "./types.js";

/** Prefix of a todo item that is implementation work. */
export const IMPLEMENT_PREFIX = "[IMPLEMENT]";
/** Prefix of a todo item that is the queued review. */
export const REVIEW_PREFIX = "[REVIEW]";
/** Prefix of a todo item that fixes a confirmed review finding. */
export const REVIEW_FIX_PREFIX = "[REVIEW-FIX]";

/** The part of a todo item the workflow needs. */
export interface TodoLike {
	id?: number;
	subject?: string;
	status?: string;
	metadata?: Record<string, unknown>;
}

const KIND_BY_NAME: Record<string, TodoKind> = {
	implement: "implement",
	implementation: "implement",
	impl: "implement",
	review: "review",
	review_pending: "review",
	"review-pending": "review",
	review_fix: "review_fix",
	"review-fix": "review_fix",
	reviewfix: "review_fix",
	other: "other",
};

/**
 * Classify a todo item.
 *
 * The metadata wins over the title: an explicit kind is more reliable than a
 * prefix. A `[REVIEW-FIX]` title is a fix item, not a review item, so the fix
 * prefix is checked first.
 */
export function classifyTodo(todo: TodoLike | null | undefined): TodoKind {
	if (!todo) return "other";

	const metadata = todo.metadata ?? {};
	const declared = metadata.kind ?? metadata.todoKind;
	if (typeof declared === "string") {
		const key = declared.toLowerCase().trim().replace(/[\s-]+/g, "_");
		const mapped = KIND_BY_NAME[key];
		if (mapped) return mapped;
	}

	const subject = (todo.subject ?? "").trim().toUpperCase();
	if (subject.startsWith(REVIEW_FIX_PREFIX)) return "review_fix";
	if (subject.startsWith(IMPLEMENT_PREFIX)) return "implement";
	if (subject.startsWith(REVIEW_PREFIX)) return "review";
	return "other";
}

/** Is the todo item still open? */
export function isOpenTodo(todo: TodoLike): boolean {
	return todo.status === "pending" || todo.status === "in_progress";
}

/** Every open todo item. */
export function openTodos(todos: TodoLike[]): TodoLike[] {
	return todos.filter((todo) => isOpenTodo(todo));
}

/**
 * The open todo items that are still implementation work.
 *
 * A queued review item is not implementation work: it must never block the
 * implementation. An unclassified item counts as implementation work, because
 * a task that is tracked without a prefix is still work that has to finish.
 */
export function implementationTodos(todos: TodoLike[]): TodoLike[] {
	return openTodos(todos).filter((todo) => {
		const kind = classifyTodo(todo);
		return kind === "implement" || kind === "other";
	});
}

/** The open todo items that represent the queued review. */
export function reviewTodos(todos: TodoLike[]): TodoLike[] {
	return openTodos(todos).filter((todo) => classifyTodo(todo) === "review");
}

/** The open todo items that fix a confirmed review finding. */
export function reviewFixTodos(todos: TodoLike[]): TodoLike[] {
	return openTodos(todos).filter((todo) => classifyTodo(todo) === "review_fix");
}

/** Does the task still have implementation work? */
export function hasOpenImplementationWork(todos: TodoLike[]): boolean {
	return implementationTodos(todos).length > 0;
}

/** How many todo items of each kind are open. */
export function summarizeTodos(todos: TodoLike[]): {
	implementation: number;
	review: number;
	reviewFix: number;
} {
	return {
		implementation: implementationTodos(todos).length,
		review: reviewTodos(todos).length,
		reviewFix: reviewFixTodos(todos).length,
	};
}

const PREFIX_BY_KIND: Record<TodoKind, string> = {
	implement: IMPLEMENT_PREFIX,
	review: REVIEW_PREFIX,
	review_fix: REVIEW_FIX_PREFIX,
	other: "",
};

/** Prefix a title with the kind of its todo item. */
export function buildTodoSubject(kind: TodoKind, text: string): string {
	const prefix = PREFIX_BY_KIND[kind];
	const clean = text.trim();
	if (!prefix) return clean;
	return clean.toUpperCase().startsWith(prefix) ? clean : `${prefix} ${clean}`;
}
