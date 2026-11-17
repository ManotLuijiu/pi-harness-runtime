/**
 * The reconciliation of the todos before a continuation or a completion.
 *
 * A request owns a list of todos. The agent finishes the work of an item and
 * the item keeps the status `in_progress`, because closing a todo needs the
 * todo tool of the agent. The controller then steers the same item again and
 * the work loops forever.
 *
 * The reconciliation checkpoint breaks that loop: the agent is asked to
 * compare every open item with the work and the validation that already
 * happened, and to close the verified items with the real todo tool. The
 * reminder never closes anything by itself - only the agent may, and only
 * after it compared the item with the work.
 */
import type { TodoItem } from "./todo-provider.js";
import type { ValidationState } from "./validation-plan.js";
/**
 * The reminder the agent receives before a continuation or a completion.
 *
 * The text is fixed: it is the checkpoint that the agent has to pass, and a
 * varying wording would let a continuation slip past it.
 */
export declare const TODO_RECONCILIATION_REMINDER: string;
/**
 * The open items of a request, with what the agent needs to compare them.
 */
export interface TodoReconciliationItem {
    id: number;
    subject: string;
    status: string;
    /** The validation state of the item, when the item declares one. */
    validation?: ValidationState;
}
/**
 * The open items of a task list (pending and in_progress).
 *
 * A completed item is not open, and a deleted one is not work either. The
 * validation state is not derived here: it comes from the ledger of the
 * runs, so the caller attaches it.
 */
export declare function todoReconciliationItems(tasks: TodoItem[]): TodoReconciliationItem[];
/**
 * The text that rides along with a continuation: the reminder and the open
 * items, one per line, with their validation state.
 *
 * The block is empty when there is no open item: a request without open work
 * has nothing to reconcile.
 */
export declare function buildTodoReconciliationBlock(open: TodoReconciliationItem[]): string;
//# sourceMappingURL=todo-reconciliation.d.ts.map