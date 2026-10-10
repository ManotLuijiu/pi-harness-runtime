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
	revision: number; // Monotonically increasing per-session version
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
export class MockTodoProvider implements TodoProvider {
	private items: TodoItem[] = [];
	private _sessionId: string;
	private _revision = 0;

	constructor(sessionId?: string) {
		this._sessionId = sessionId ?? `mock-${Date.now()}`;
	}

	async availability(): Promise<TodoAvailability> {
		return { available: true, provider: "mock" };
	}

	async getSnapshot(): Promise<TodoSnapshot> {
		this._revision++;
		return {
			items: [...this.items],
			sessionId: this._sessionId,
			revision: this._revision,
			createdAt: new Date(),
		};
	}

	async getByStatus(status: TodoStatus): Promise<TodoItem[]> {
		return this.items.filter((item) => item.status === status);
	}

	async getInProgress(): Promise<TodoItem[]> {
		return this.getByStatus("in_progress");
	}

	async getPending(): Promise<TodoItem[]> {
		return this.items.filter((item) => item.status === "pending");
	}

	async getCompleted(): Promise<TodoItem[]> {
		return this.getByStatus("completed");
	}

	async getReady(): Promise<TodoItem[]> {
		const pending = await this.getPending();
		return pending.filter((item) => {
			if (!item.blockedBy?.length) return true;
			const blockedIds = new Set(item.blockedBy);
			return !this.items.some(
				(i) => blockedIds.has(i.id) && i.status !== "completed"
			);
		});
	}

	async getBlocked(): Promise<TodoItem[]> {
		const pending = await this.getPending();
		return pending.filter((item) => {
			if (!item.blockedBy?.length) return false;
			const blockedIds = new Set(item.blockedBy);
			return this.items.some(
				(i) => blockedIds.has(i.id) && i.status !== "completed"
			);
		});
	}

	// Test helpers
	addItem(item: Omit<TodoItem, "id">): TodoItem {
		const id = this.items.length + 1;
		const newItem: TodoItem = { ...item, id };
		this.items.push(newItem);
		return newItem;
	}

	setStatus(id: number, status: TodoStatus): void {
		const item = this.items.find((i) => i.id === id);
		if (item) {
			item.status = status;
		}
	}

	clear(): void {
		this.items = [];
		this._revision++;
	}
}

/**
 * Create a todo provider based on available tools
 */
export function createTodoProvider(pi?: ExtensionAPI): TodoProvider {
	// For now, return mock provider
	// TODO: Integrate with actual Pi todo extension when available
	return new MockTodoProvider();
}
