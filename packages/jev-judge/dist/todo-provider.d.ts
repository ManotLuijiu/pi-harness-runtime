/**
 * Todo Provider - Read local todo state
 *
 * Provides typed access to the local todo list.
 * Separates todo from bd (issue tracker).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * Todo item status
 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";
/**
 * A single todo item
 */
export interface TodoItem {
    id: number;
    subject: string;
    description?: string;
    status: TodoStatus;
    activeForm?: string;
    blockedBy?: number[];
    owner?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Snapshot of the todo list at a point in time
 */
export interface TodoSnapshot {
    items: TodoItem[];
    sessionId: string;
    revision: number;
    createdAt: Date;
}
/**
 * Availability result for todo provider
 */
export interface TodoAvailability {
    available: boolean;
    error?: string;
    provider?: string;
}
/**
 * Todo Provider interface
 */
export interface TodoProvider {
    /**
     * Check if todo is available
     */
    availability(): Promise<TodoAvailability>;
    /**
     * Get current snapshot of todo list
     */
    getSnapshot(): Promise<TodoSnapshot>;
    /**
     * Get items by status
     */
    getByStatus(status: TodoStatus): Promise<TodoItem[]>;
    /**
     * Get in-progress items
     */
    getInProgress(): Promise<TodoItem[]>;
    /**
     * Get pending items (not completed)
     */
    getPending(): Promise<TodoItem[]>;
    /**
     * Get completed items
     */
    getCompleted(): Promise<TodoItem[]>;
    /**
     * Get ready items (pending with satisfied dependencies)
     */
    getReady(): Promise<TodoItem[]>;
    /**
     * Get blocked items (pending with unsatisfied dependencies)
     */
    getBlocked(): Promise<TodoItem[]>;
}
/**
 * Mock Todo Provider for testing
 */
export declare class MockTodoProvider implements TodoProvider {
    private items;
    private _sessionId;
    private _revision;
    constructor(sessionId?: string);
    availability(): Promise<TodoAvailability>;
    getSnapshot(): Promise<TodoSnapshot>;
    getByStatus(status: TodoStatus): Promise<TodoItem[]>;
    getInProgress(): Promise<TodoItem[]>;
    getPending(): Promise<TodoItem[]>;
    getCompleted(): Promise<TodoItem[]>;
    getReady(): Promise<TodoItem[]>;
    getBlocked(): Promise<TodoItem[]>;
    addItem(item: Omit<TodoItem, "id">): TodoItem;
    setStatus(id: number, status: TodoStatus): void;
    clear(): void;
}
/**
 * Create a todo provider based on available tools
 */
export declare function createTodoProvider(pi?: ExtensionAPI): TodoProvider;
//# sourceMappingURL=todo-provider.d.ts.map