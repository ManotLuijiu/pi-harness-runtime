/**
 * Todo Provider - Read local todo state
 *
 * Provides typed access to the local todo list.
 * Separates todo from bd (issue tracker).
 */
/**
 * Mock Todo Provider for testing
 */
export class MockTodoProvider {
    items = [];
    _sessionId;
    _revision = 0;
    constructor(sessionId) {
        this._sessionId = sessionId ?? `mock-${Date.now()}`;
    }
    async availability() {
        return { available: true, provider: "mock" };
    }
    async getSnapshot() {
        this._revision++;
        return {
            items: [...this.items],
            sessionId: this._sessionId,
            revision: this._revision,
            createdAt: new Date(),
        };
    }
    async getByStatus(status) {
        return this.items.filter((item) => item.status === status);
    }
    async getInProgress() {
        return this.getByStatus("in_progress");
    }
    async getPending() {
        return this.items.filter((item) => item.status === "pending");
    }
    async getCompleted() {
        return this.getByStatus("completed");
    }
    async getReady() {
        const pending = await this.getPending();
        return pending.filter((item) => {
            if (!item.blockedBy?.length)
                return true;
            const blockedIds = new Set(item.blockedBy);
            return !this.items.some((i) => blockedIds.has(i.id) && i.status !== "completed");
        });
    }
    async getBlocked() {
        const pending = await this.getPending();
        return pending.filter((item) => {
            if (!item.blockedBy?.length)
                return false;
            const blockedIds = new Set(item.blockedBy);
            return this.items.some((i) => blockedIds.has(i.id) && i.status !== "completed");
        });
    }
    // Test helpers
    addItem(item) {
        const id = this.items.length + 1;
        const newItem = { ...item, id };
        this.items.push(newItem);
        return newItem;
    }
    setStatus(id, status) {
        const item = this.items.find((i) => i.id === id);
        if (item) {
            item.status = status;
        }
    }
    clear() {
        this.items = [];
        this._revision++;
    }
}
/**
 * Create a todo provider that reads from rpiv-todo state via session branch
 */
export function createTodoProvider(ctx) {
    // Accept either TodoContext or ExtensionAPI with sessionManager
    if (ctx && "sessionManager" in ctx) {
        return new PiTodoProvider(ctx);
    }
    return new PiUnavailableTodoProvider();
}
/**
 * Provider that reads rpiv-todo state from session branch
 * Replicates rpiv-todo's replayFromBranch logic to access todo state
 */
class PiTodoProvider {
    ctx;
    _revision = 0;
    _lastError = null;
    constructor(ctx) {
        this.ctx = ctx;
    }
    async availability() {
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
    isTaskDetails(value) {
        if (!value || typeof value !== "object")
            return false;
        const v = value;
        return Array.isArray(v.tasks) && typeof v.nextId === "number";
    }
    /**
     * Get todo state from session branch (replicates rpiv-todo's replayFromBranch)
     * Returns null if branch read fails (don't silently return empty state)
     */
    getTodoState() {
        let fromEntries;
        let fromToolResults;
        try {
            const branch = this.ctx.sessionManager.getBranch();
            for (const entry of branch) {
                const e = entry;
                // Priority 1: rpiv-todo-state custom entries
                if (e.type === "custom") {
                    if (e.customType === "rpiv-todo-state" && this.isTaskDetails(e.data)) {
                        fromEntries = { tasks: e.data.tasks.map(t => ({ ...t })), nextId: e.data.nextId };
                    }
                    continue;
                }
                // Priority 2: toolResult entries with toolName === "todo"
                if (e.type !== "message")
                    continue;
                const msg = e.message;
                if (msg?.role !== "toolResult" || msg.toolName !== "todo")
                    continue;
                if (!this.isTaskDetails(msg.details))
                    continue;
                fromToolResults = { tasks: msg.details.tasks.map(t => ({ ...t })), nextId: msg.details.nextId };
            }
        }
        catch (err) {
            // Return null on error - don't silently return empty state
            this._lastError = err instanceof Error ? err.message : String(err);
            return null;
        }
        // Prefer custom entries (more authoritative), fall back to tool results
        this._lastError = null;
        return fromEntries ?? fromToolResults ?? null;
    }
    async getSnapshot() {
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
    async getByStatus(status) {
        const { items } = await this.getSnapshot();
        return items.filter((item) => item.status === status);
    }
    async getInProgress() {
        return this.getByStatus("in_progress");
    }
    async getPending() {
        return this.getByStatus("pending");
    }
    async getCompleted() {
        return this.getByStatus("completed");
    }
    async getReady() {
        const pending = await this.getPending();
        const all = (await this.getSnapshot()).items;
        return pending.filter((item) => {
            if (!item.blockedBy?.length)
                return true;
            const blockedIds = new Set(item.blockedBy);
            return !all.some((i) => blockedIds.has(i.id) && i.status !== "completed");
        });
    }
    async getBlocked() {
        const pending = await this.getPending();
        const all = (await this.getSnapshot()).items;
        return pending.filter((item) => {
            if (!item.blockedBy?.length)
                return false;
            const blockedIds = new Set(item.blockedBy);
            return all.some((i) => blockedIds.has(i.id) && i.status !== "completed");
        });
    }
}
/**
 * Provider that reports Pi todo extension is not available
 */
class PiUnavailableTodoProvider {
    async availability() {
        return {
            available: false,
            error: "Pi session manager not available. Todo state is not accessible.",
            provider: "pi-todo",
        };
    }
    async getSnapshot() {
        throw new Error("Pi todo extension is not available");
    }
    async getByStatus(_status) {
        return [];
    }
    async getInProgress() {
        return [];
    }
    async getPending() {
        return [];
    }
    async getCompleted() {
        return [];
    }
    async getReady() {
        return [];
    }
    async getBlocked() {
        return [];
    }
}
/**
 * Provider that reports Pi todo extension is not available
 */
//# sourceMappingURL=todo-provider.js.map