/**
 * Types for todo-bd-sync
 * Two-way sync between rpiv-todo overlay and bd issue tracker
 */
export interface TodoTask {
    id: number;
    subject: string;
    description?: string;
    activeForm?: string;
    status: TodoStatus;
    blockedBy?: number[];
    owner?: string;
    metadata?: {
        bdId?: string;
        lastSync?: number;
        [key: string]: unknown;
    };
}
export type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";
export interface BdIssue {
    id: string;
    title: string;
    status: BdStatus;
    priority?: number;
    createdAt?: string;
    updatedAt?: string;
}
export type BdStatus = "open" | "in_progress" | "closed" | "blocked";
export type SyncDirection = "todo_to_bd" | "bd_to_todo" | "session_start";
export interface SyncConflict {
    task: TodoTask;
    bdIssue: BdIssue;
    timestamp: number;
    resolution: "todo_wins" | "bd_wins" | "recent_wins";
}
export interface SyncResult {
    success: boolean;
    direction: SyncDirection;
    taskId?: number;
    bdId?: string;
    action?: string;
    error?: string;
}
export interface IdMapping {
    todoId: number;
    bdId: string;
    createdAt: number;
    lastSync: number;
}
export declare class IdMappingRegistry {
    private mappings;
    private bdMappings;
    set(todoId: number, bdId: string): void;
    getByTodoId(todoId: number): IdMapping | undefined;
    getByBdId(bdId: string): IdMapping | undefined;
    hasTodoId(todoId: number): boolean;
    hasBdId(bdId: string): boolean;
    updateLastSync(todoId: number): void;
    delete(todoId: number): void;
    getAll(): IdMapping[];
    clear(): void;
}
export declare const STATUS_MAP: Record<TodoStatus, BdStatus>;
export declare const BD_STATUS_MAP: Record<BdStatus, TodoStatus>;
//# sourceMappingURL=types.d.ts.map