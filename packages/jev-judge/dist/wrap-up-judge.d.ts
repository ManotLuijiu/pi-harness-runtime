/**
 * Wrap-Up Judge - Block until ALL todos complete
 *
 * Simple rule: ALL tasks must be done before summary.
 * Agent cannot pass incomplete tasks to user.
 */
export interface TodoItem {
    id: number;
    subject: string;
    status: "pending" | "in_progress" | "completed";
}
export interface WrapUpResult {
    ready: boolean;
    completedCount: number;
    totalCount: number;
    incompleteTasks: TodoItem[];
    message: string;
}
/**
 * Check if all todos are complete
 */
export declare function checkWrapUp(todos: TodoItem[]): WrapUpResult;
/**
 * Get status summary
 */
export declare function getTodoSummary(todos: TodoItem[]): string;
//# sourceMappingURL=wrap-up-judge.d.ts.map