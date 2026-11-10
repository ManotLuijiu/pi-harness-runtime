/**
 * Todo Provider - Read local todo state
 *
 * Provides typed access to the local todo list.
 * Separates todo from bd (issue tracker).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
/**
 * Minimal context interface for todo provider
 * Contains only the properties needed to read session branch and send messages
 */
export interface TodoContext {
    sessionManager: {
        getSessionId(): string;
        getBranch(): Iterable<unknown>;
    };
    isIdle?: () => boolean;
    hasPendingMessages?: () => boolean;
    sendUserMessage?: (content: string, opts?: {
        deliverAs?: string;
    }) => Promise<void>;
}
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
 * The state of the list after one change.
 *
 * The history of the list is the sequence of these states. It says what a
 * change touched, also when the item is back in the state it had before: a
 * todo that was reopened and finished again is work of the request that
 * did it.
 */
export interface TodoHistoryEntry {
    /** The list as it was after the change. */
    items: TodoItem[];
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
    /**
     * The history of the list: the state after every change.
     *
     * The list alone says what the work is now. The history says what a
     * request touched, also when the item is back in the state it had
     * before.
     */
    getHistory(): Promise<TodoHistoryEntry[]>;
}
/**
 * Mock Todo Provider for testing
 */
export declare class MockTodoProvider implements TodoProvider {
    private items;
    private _sessionId;
    private _revision;
    /** The state of the list after every change. */
    private history;
    constructor(sessionId?: string);
    availability(): Promise<TodoAvailability>;
    getSnapshot(): Promise<TodoSnapshot>;
    getByStatus(status: TodoStatus): Promise<TodoItem[]>;
    getHistory(): Promise<TodoHistoryEntry[]>;
    getInProgress(): Promise<TodoItem[]>;
    getPending(): Promise<TodoItem[]>;
    getCompleted(): Promise<TodoItem[]>;
    getReady(): Promise<TodoItem[]>;
    getBlocked(): Promise<TodoItem[]>;
    addItem(item: Omit<TodoItem, "id">): TodoItem;
    setStatus(id: number, status: TodoStatus): void;
    clear(): void;
    /** Remember the state of the list after a change. */
    private record;
}
/**
 * Create a todo provider that reads from rpiv-todo state via session branch
 */
export declare function createTodoProvider(ctx?: TodoContext | ExtensionAPI): TodoProvider;
/**
 * Provider that reports Pi todo extension is not available
 */
//# sourceMappingURL=todo-provider.d.ts.map