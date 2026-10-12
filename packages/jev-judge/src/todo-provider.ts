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
	sendUserMessage?: (content: string, opts?: { deliverAs?: string }) => Promise<void>;
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
 * Create a todo provider that reads from rpiv-todo state via session branch
 */
export function createTodoProvider(ctx?: TodoContext | ExtensionAPI): TodoProvider {
	// Accept either TodoContext or ExtensionAPI with sessionManager
	if (ctx && "sessionManager" in ctx) {
		return new PiTodoProvider(ctx as TodoContext);
	}
	return new PiUnavailableTodoProvider();
}

/**
 * Provider that reads rpiv-todo state from session branch
 * Replicates rpiv-todo's replayFromBranch logic to access todo state
 */
class PiTodoProvider implements TodoProvider {
	private ctx: TodoContext;
	private _revision = 0;
	private _lastError: string | null = null;

	constructor(ctx: TodoContext) {
		this.ctx = ctx;
	}

	async availability(): Promise<TodoAvailability> {
		if (!this.ctx.sessionManager) {
			return {
				available: false,
				error: "Session manager not available",
				provider: "pi-todo",
			};
		}
		return { available: true, provider: "pi-todo" };
	}

	/**
	 * Check if a value is a TaskDetails shape (defensive validation)
	 */
	private isTaskDetails(value: unknown): value is { tasks: TodoItem[]; nextId: number } {
		if (!value || typeof value !== "object") return false;
		const v = value as Record<string, unknown>;
		return Array.isArray(v.tasks) && typeof v.nextId === "number";
	}

	/**
	 * Get todo state from session branch (replicates rpiv-todo's replayFromBranch)
	 * Returns null if branch read fails (don't silently return empty state)
	 */
	private getTodoState(): { tasks: TodoItem[]; nextId: number } | null {
		let fromEntries: { tasks: TodoItem[]; nextId: number } | undefined;
		let fromToolResults: { tasks: TodoItem[]; nextId: number } | undefined;

		try {
			const branch = this.ctx.sessionManager.getBranch();
			for (const entry of branch) {
				const e = entry as {
					type?: string;
					customType?: string;
					data?: unknown;
					message?: { role?: string; toolName?: string; details?: unknown };
				};

				// Priority 1: rpiv-todo-state custom entries
				if (e.type === "custom") {
					if (e.customType === "rpiv-todo-state" && this.isTaskDetails(e.data)) {
						fromEntries = { tasks: (e.data as { tasks: TodoItem[] }).tasks.map(t => ({ ...t })), nextId: (e.data as { nextId: number }).nextId };
					}
					continue;
				}

				// Priority 2: toolResult entries with toolName === "todo"
				if (e.type !== "message") continue;
				const msg = e.message;
				if (msg?.role !== "toolResult" || msg.toolName !== "todo") continue;
				if (!this.isTaskDetails(msg.details)) continue;
				fromToolResults = { tasks: (msg.details as { tasks: TodoItem[] }).tasks.map(t => ({ ...t })), nextId: (msg.details as { nextId: number }).nextId };
			}
		} catch (err) {
			// Return null on error - don't silently return empty state
			this._lastError = err instanceof Error ? err.message : String(err);
			return null;
		}

		// Prefer custom entries (more authoritative), fall back to tool results
		this._lastError = null;
		return fromEntries ?? fromToolResults ?? null;
	}

	async getSnapshot(): Promise<TodoSnapshot> {
		this._revision++;
		const state = this.getTodoState();
		
		// If branch read failed, throw to indicate unavailable state
		if (state === null) {
			throw new Error(`Todo state unavailable: ${this._lastError ?? "branch read failed"}`);
		}
		
		return {
			items: state.tasks,
			sessionId: this.ctx.sessionManager.getSessionId() ?? "unknown",
			revision: this._revision,
			createdAt: new Date(),
		};
	}

	async getByStatus(status: TodoStatus): Promise<TodoItem[]> {
		const { items } = await this.getSnapshot();
		return items.filter((item) => item.status === status);
	}

	async getInProgress(): Promise<TodoItem[]> {
		return this.getByStatus("in_progress");
	}

	async getPending(): Promise<TodoItem[]> {
		return this.getByStatus("pending");
	}

	async getCompleted(): Promise<TodoItem[]> {
		return this.getByStatus("completed");
	}

	async getReady(): Promise<TodoItem[]> {
		const pending = await this.getPending();
		const all = (await this.getSnapshot()).items;
		return pending.filter((item) => {
			if (!item.blockedBy?.length) return true;
			const blockedIds = new Set(item.blockedBy);
			return !all.some((i) => blockedIds.has(i.id) && i.status !== "completed");
		});
	}

	async getBlocked(): Promise<TodoItem[]> {
		const pending = await this.getPending();
		const all = (await this.getSnapshot()).items;
		return pending.filter((item) => {
			if (!item.blockedBy?.length) return false;
			const blockedIds = new Set(item.blockedBy);
			return all.some((i) => blockedIds.has(i.id) && i.status !== "completed");
		});
	}
}

/**
 * Provider that reports Pi todo extension is not available
 */
class PiUnavailableTodoProvider implements TodoProvider {
	async availability(): Promise<TodoAvailability> {
		return {
			available: false,
			error: "Pi session manager not available. Todo state is not accessible.",
			provider: "pi-todo",
		};
	}

	async getSnapshot(): Promise<TodoSnapshot> {
		throw new Error("Pi todo extension is not available");
	}

	async getByStatus(_status: TodoStatus): Promise<TodoItem[]> {
		return [];
	}

	async getInProgress(): Promise<TodoItem[]> {
		return [];
	}

	async getPending(): Promise<TodoItem[]> {
		return [];
	}

	async getCompleted(): Promise<TodoItem[]> {
		return [];
	}

	async getReady(): Promise<TodoItem[]> {
		return [];
	}

	async getBlocked(): Promise<TodoItem[]> {
		return [];
	}
}

/**
 * Provider that reports Pi todo extension is not available
 */

