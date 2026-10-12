/**
 * Synthetic Todo Provider for E2E Testing
 * 
 * Provides deterministic todo state for testing without real Pi/todo integration.
 */

export interface TodoItem {
	id: number;
	subject: string;
	status: "pending" | "in_progress" | "completed" | "deleted";
	blockedBy?: number[];
	createdAt: number;
	completedAt?: number;
}

export interface TodoSnapshot {
	items: TodoItem[];
	count: number;
}

/**
 * Synthetic todo provider for E2E tests
 */
export class SyntheticTodoProvider {
	private items: TodoItem[] = [];
	private nextId = 1;
	private revision = 0;

	async getSnapshot(): Promise<TodoSnapshot> {
		return {
			items: [...this.items],
			count: this.items.length,
		};
	}

	async create(subject: string, blockedBy?: number[]): Promise<number> {
		const id = this.nextId++;
		this.items.push({
			id,
			subject,
			status: "pending",
			blockedBy,
			createdAt: Date.now(),
		});
		this.revision++;
		return id;
	}

	async complete(id: number): Promise<void> {
		const item = this.items.find(i => i.id === id);
		if (item) {
			item.status = "completed";
			item.completedAt = Date.now();
			this.revision++;
		}
	}

	async delete(id: number): Promise<void> {
		const item = this.items.find(i => i.id === id);
		if (item) {
			item.status = "deleted";
			this.revision++;
		}
	}

	async getById(id: number): Promise<TodoItem | null> {
		return this.items.find(i => i.id === id && i.status !== "deleted") ?? null;
	}

	async getPending(): Promise<TodoItem[]> {
		return this.items.filter(i => i.status === "pending");
	}

	async getReady(): Promise<TodoItem[]> {
		return this.items.filter(item => {
			if (item.status !== "pending") return false;
			// Check blockers are all completed
			if (item.blockedBy && item.blockedBy.length > 0) {
				return item.blockedBy.every(blockerId => {
					const blocker = this.items.find(i => i.id === blockerId);
					return blocker?.status === "completed";
				});
			}
			return true;
		});
	}

	reset(): void {
		this.items = [];
		this.nextId = 1;
		this.revision = 0;
	}

	getRevision(): number {
		return this.revision;
	}
}
