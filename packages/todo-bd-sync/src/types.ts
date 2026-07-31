/**
 * Types for todo-bd-sync
 * Two-way sync between rpiv-todo overlay and bd issue tracker
 */

// Task from rpiv-todo
export interface TodoTask {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TodoStatus;
	blockedBy?: number[];
	owner?: string;
	metadata?: {
		bdId?: string; // Mapped bd issue ID (e.g., "bd-a1b2")
		lastSync?: number; // Timestamp of last sync
		[key: string]: unknown;
	};
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";

// Bd issue structure
export interface BdIssue {
	id: string;
	title: string;
	status: BdStatus;
	priority?: number;
	createdAt?: string;
	updatedAt?: string;
}

export type BdStatus = "open" | "in_progress" | "closed" | "blocked";

// Sync event types
export type SyncDirection = "todo_to_bd" | "bd_to_todo" | "session_start";

// Conflict resolution
export interface SyncConflict {
	task: TodoTask;
	bdIssue: BdIssue;
	timestamp: number;
	resolution: "todo_wins" | "bd_wins" | "recent_wins";
}

// Sync result
export interface SyncResult {
	success: boolean;
	direction: SyncDirection;
	taskId?: number;
	bdId?: string;
	action?: string;
	error?: string;
}

// ID mapping storage
export interface IdMapping {
	todoId: number;
	bdId: string;
	createdAt: number;
	lastSync: number;
}

// Registry of ID mappings
export class IdMappingRegistry {
	private mappings: Map<number, IdMapping> = new Map(); // todoId -> mapping
	private bdMappings: Map<string, number> = new Map(); // bdId -> todoId

	set(todoId: number, bdId: string): void {
		const now = Date.now();
		const mapping: IdMapping = {
			todoId,
			bdId,
			createdAt: now,
			lastSync: now,
		};
		this.mappings.set(todoId, mapping);
		this.bdMappings.set(bdId, todoId);
	}

	getByTodoId(todoId: number): IdMapping | undefined {
		return this.mappings.get(todoId);
	}

	getByBdId(bdId: string): IdMapping | undefined {
		const todoId = this.bdMappings.get(bdId);
		return todoId !== undefined ? this.mappings.get(todoId) : undefined;
	}

	hasTodoId(todoId: number): boolean {
		return this.mappings.has(todoId);
	}

	hasBdId(bdId: string): boolean {
		return this.bdMappings.has(bdId);
	}

	updateLastSync(todoId: number): void {
		const mapping = this.mappings.get(todoId);
		if (mapping) {
			mapping.lastSync = Date.now();
		}
	}

	delete(todoId: number): void {
		const mapping = this.mappings.get(todoId);
		if (mapping) {
			this.bdMappings.delete(mapping.bdId);
			this.mappings.delete(todoId);
		}
	}

	getAll(): IdMapping[] {
		return Array.from(this.mappings.values());
	}

	clear(): void {
		this.mappings.clear();
		this.bdMappings.clear();
	}
}

// Status mapping between todo and bd
export const STATUS_MAP: Record<TodoStatus, BdStatus> = {
	pending: "open",
	in_progress: "in_progress",
	completed: "closed",
	deleted: "closed",
};

export const BD_STATUS_MAP: Record<BdStatus, TodoStatus> = {
	open: "pending",
	in_progress: "in_progress",
	closed: "completed",
	blocked: "pending",
};
